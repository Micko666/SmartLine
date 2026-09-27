-- ============================================================
-- 024_payment_recording
--
-- Payment state is independent of the kitchen/fulfillment status:
--   orders.status          placed -> preparing -> ready -> completed (+ cancelled/refunded)
--   orders.payment_status  unpaid -> paid (-> refunded); legacy_unverified for
--                          orders created before payment tracking existed.
-- No payment provider is integrated, so money is recorded by staff:
--   record_payment(order)                    owner (authenticated)
--   station_record_payment(session, order)  station with canRecordPayments
-- Both are idempotent and never touch the fulfillment status.
--
-- get_order_status now returns placedAt (created_at): paid_at is NULL for
-- unpaid orders, which made the customer tracker compute NaN minutes.
--
-- Existing data: service stations get canRecordPayments=true (the counter
-- collects in-person payments); legacy 'paid' in visibleStatuses -> 'placed'.
-- ============================================================

-- paid_at means "payment recorded"; a default of now() would mark any row
-- inserted without it as paid at creation. Existing values are kept.
ALTER TABLE orders ALTER COLUMN paid_at DROP DEFAULT;

UPDATE stations
   SET permissions = permissions || jsonb_build_object('canRecordPayments', true)
 WHERE role = 'service' AND NOT (permissions ? 'canRecordPayments');

UPDATE stations
   SET permissions = jsonb_set(permissions, '{visibleStatuses}',
         (SELECT COALESCE(jsonb_agg(CASE WHEN v = 'paid' THEN 'placed' ELSE v END), '[]'::jsonb)
            FROM jsonb_array_elements_text(permissions->'visibleStatuses') v))
 WHERE jsonb_typeof(permissions->'visibleStatuses') = 'array'
   AND permissions->'visibleStatuses' ? 'paid';

/** Shared rule: only a live (not cancelled/refunded) unpaid order can be marked paid. */
CREATE OR REPLACE FUNCTION record_payment_internal(p_user_id uuid, p_order_id uuid, p_actor text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o orders%ROWTYPE;
BEGIN
  SELECT * INTO o FROM orders WHERE id = p_order_id AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF o.payment_status = 'paid' THEN RETURN jsonb_build_object('ok', true, 'order', to_jsonb(o)); END IF;
  IF o.status IN ('cancelled', 'refunded') THEN RAISE EXCEPTION 'Order is cancelled'; END IF;
  IF o.payment_status <> 'unpaid' THEN RAISE EXCEPTION 'Payment state % cannot be recorded', o.payment_status; END IF;
  UPDATE orders SET payment_status = 'paid', paid_at = now(), updated_at = now(), last_actor = p_actor
   WHERE id = o.id RETURNING * INTO o;
  UPDATE receipts SET payment_status = 'paid' WHERE order_id = o.id;
  RETURN jsonb_build_object('ok', true, 'order', to_jsonb(o));
END $$;

CREATE OR REPLACE FUNCTION record_payment(p_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  RETURN record_payment_internal(auth.uid(), p_order_id, 'owner:' || auth.uid());
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END $$;

CREATE OR REPLACE FUNCTION station_record_payment(p_session_token text, p_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE st stations%ROWTYPE;
BEGIN
  st := station_require_session(p_session_token);
  IF NOT station_perm(st, 'canRecordPayments') THEN RAISE EXCEPTION 'Station may not record payments'; END IF;
  RETURN record_payment_internal(st.user_id, p_order_id, 'station:' || st.id);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END $$;

CREATE OR REPLACE FUNCTION get_order_status(p_restaurant_token text, p_order_number integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user_id uuid; v_business_name text; o orders%ROWTYPE;
BEGIN
  SELECT user_id, business_name INTO v_user_id, v_business_name FROM business_settings WHERE restaurant_token = p_restaurant_token;
  IF v_user_id IS NULL THEN RETURN jsonb_build_object('ok', false); END IF;
  SELECT * INTO o FROM orders WHERE user_id = v_user_id AND order_number = p_order_number ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false); END IF;
  -- Status, timing and payment state only: no customer contact data.
  RETURN jsonb_build_object(
    'ok', true, 'orderNumber', o.order_number, 'status', o.status, 'tableName', o.table_name,
    'estimatedPrepTime', o.estimated_prep_time, 'prepTimeAdjustment', o.prep_time_adjustment,
    'placedAt', o.created_at, 'paymentStatus', o.payment_status, 'restaurantName', COALESCE(v_business_name, ''));
END $$;

REVOKE ALL ON FUNCTION record_payment_internal(uuid, uuid, text), record_payment(uuid), station_record_payment(text, uuid), get_order_status(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_order_status(text, integer), station_record_payment(text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION record_payment(uuid) TO authenticated;
