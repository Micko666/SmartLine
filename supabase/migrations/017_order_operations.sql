-- One state machine/cancellation implementation, shared by owner and stations.
CREATE OR REPLACE FUNCTION order_transition_allowed(p_from text,p_to text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 SELECT (p_from='placed' AND p_to IN ('preparing','cancelled')) OR
 (p_from='preparing' AND p_to IN ('ready','cancelled')) OR
 (p_from='ready' AND p_to IN ('completed','cancelled')) OR
 (p_from='cancelled' AND p_to='refunded');
$$;
-- Rework (ready -> preparing) is allowed only for an actor tagged ':rework'
-- (a station with canReworkOrders). One definition used by trigger and RPCs.
CREATE OR REPLACE FUNCTION order_transition_allowed_by(p_from text,p_to text,p_actor text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 SELECT order_transition_allowed(p_from,p_to) OR (p_from='ready' AND p_to='preparing' AND COALESCE(p_actor,'') LIKE '%:rework');
$$;
CREATE OR REPLACE FUNCTION enforce_order_transition() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$ BEGIN
 IF NEW.status IS DISTINCT FROM OLD.status AND NOT order_transition_allowed_by(OLD.status,NEW.status,NEW.last_actor) THEN
  RAISE EXCEPTION 'Invalid order transition: % -> %',OLD.status,NEW.status;
 END IF;
 IF NEW.status IS DISTINCT FROM OLD.status THEN NEW.updated_at:=now(); END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER orders_transition_guard BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION enforce_order_transition();

CREATE OR REPLACE FUNCTION transition_order_internal(p_user_id uuid,p_order_id uuid,p_expected_status text,p_new_status text,p_actor text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE o orders%ROWTYPE; x jsonb; BEGIN
 -- Same lock order as checkout prevents cancel/checkout deadlocks.
 PERFORM 1 FROM business_settings WHERE user_id=p_user_id FOR UPDATE;
 SELECT * INTO o FROM orders WHERE id=p_order_id AND user_id=p_user_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
 IF o.status=p_new_status AND p_new_status='cancelled' THEN RETURN jsonb_build_object('ok',true,'order',to_jsonb(o)); END IF;
 IF o.status IS DISTINCT FROM p_expected_status THEN RAISE EXCEPTION 'Order changed; refresh and try again'; END IF;
 IF NOT order_transition_allowed_by(o.status,p_new_status,p_actor) THEN RAISE EXCEPTION 'Invalid order transition'; END IF;
 IF p_new_status='cancelled' AND o.stock_restored_at IS NULL THEN
  FOR x IN SELECT value FROM jsonb_array_elements(o.items) LOOP
   UPDATE menu_items SET stock=CASE WHEN stock IS NULL THEN NULL ELSE stock+(x->>'quantity')::int END,sales_count=greatest(0,COALESCE(sales_count,0)-(x->>'quantity')::int),updated_at=now() WHERE user_id=p_user_id AND id=(x->>'menuItemId')::uuid;
  END LOOP;
  o.stock_restored_at:=now();
 END IF;
 -- A refund reverses a recorded payment; unpaid/legacy payment states are left as they are.
 UPDATE orders SET status=p_new_status,stock_restored_at=o.stock_restored_at,last_actor=p_actor,updated_at=now(),
  payment_status=CASE WHEN p_new_status='refunded' AND payment_status='paid' THEN 'refunded' ELSE payment_status END
  WHERE id=o.id RETURNING * INTO o;
 IF p_new_status IN ('cancelled','completed','refunded') AND NOT EXISTS(SELECT 1 FROM orders WHERE user_id=p_user_id AND table_id=o.table_id AND status IN ('placed','preparing','ready')) THEN
  UPDATE tables SET status='available' WHERE user_id=p_user_id AND id::text=o.table_id AND status='occupied';
 END IF;
 RETURN jsonb_build_object('ok',true,'order',to_jsonb(o));
END $$;
CREATE OR REPLACE FUNCTION advance_order(p_order_id uuid,p_expected_status text,p_new_status text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 RETURN transition_order_internal(auth.uid(),p_order_id,p_expected_status,p_new_status,'owner:'||auth.uid());
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok',false,'error',SQLERRM); END $$;
CREATE OR REPLACE FUNCTION cancel_order(p_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_status text; BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 PERFORM 1 FROM business_settings WHERE user_id=auth.uid() FOR UPDATE;
 SELECT status INTO v_status FROM orders WHERE id=p_order_id AND user_id=auth.uid() FOR UPDATE;
 RETURN transition_order_internal(auth.uid(),p_order_id,v_status,'cancelled','owner:'||auth.uid());
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok',false,'error',SQLERRM); END $$;
CREATE OR REPLACE FUNCTION adjust_stock(p_item_id uuid,p_delta int)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE m menu_items%ROWTYPE; BEGIN
 IF auth.uid() IS NULL OR p_delta IS NULL OR abs(p_delta::bigint)>100000 THEN RAISE EXCEPTION 'Invalid stock adjustment'; END IF;
 UPDATE menu_items SET stock=greatest(0,stock+p_delta),updated_at=now() WHERE id=p_item_id AND user_id=auth.uid() AND stock IS NOT NULL RETURNING * INTO m;
 IF NOT FOUND THEN RAISE EXCEPTION 'Stock-tracked item not found'; END IF;
 RETURN jsonb_build_object('ok',true,'item',to_jsonb(m));
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok',false,'error',SQLERRM); END $$;
CREATE OR REPLACE FUNCTION patch_settings(p_patch jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s business_settings%ROWTYPE; k text; allowed text[]:=ARRAY['business_name','business_type','currency','currency_symbol','tax_rate','tax_display','language','timezone','opening_hours','service_mode','low_stock_threshold','zero_stock_behavior','app_url','logo_url','ordering_paused','ordering_paused_message','takeaway_enabled','delivery_enabled','business_hours','calendar_settings','categories']; BEGIN
 IF auth.uid() IS NULL OR jsonb_typeof(p_patch) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid settings patch'; END IF;
 FOR k IN SELECT jsonb_object_keys(p_patch) LOOP IF NOT k=ANY(allowed) THEN RAISE EXCEPTION 'Setting is not editable: %',k; END IF; END LOOP;
 SELECT * INTO s FROM business_settings WHERE user_id=auth.uid() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Restaurant not found'; END IF;
 -- Merge a changed calendar field into current server JSON, not a stale client snapshot.
 IF p_patch ? 'calendar_settings' THEN p_patch:=jsonb_set(p_patch,'{calendar_settings}',COALESCE(s.calendar_settings,'{}')||(p_patch->'calendar_settings')); END IF;
 s:=jsonb_populate_record(s,p_patch);
 IF NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=s.timezone) OR s.tax_rate NOT BETWEEN 0 AND 100 THEN RAISE EXCEPTION 'Invalid timezone or tax rate'; END IF;
 UPDATE business_settings SET business_name=s.business_name,business_type=s.business_type,currency=s.currency,currency_symbol=s.currency_symbol,tax_rate=s.tax_rate,tax_display=s.tax_display,language=s.language,timezone=s.timezone,opening_hours=s.opening_hours,service_mode=s.service_mode,low_stock_threshold=s.low_stock_threshold,zero_stock_behavior=s.zero_stock_behavior,app_url=s.app_url,logo_url=s.logo_url,ordering_paused=s.ordering_paused,ordering_paused_message=s.ordering_paused_message,takeaway_enabled=s.takeaway_enabled,delivery_enabled=s.delivery_enabled,business_hours=s.business_hours,calendar_settings=s.calendar_settings,categories=s.categories WHERE user_id=auth.uid();
 RETURN jsonb_build_object('ok',true,'settings',to_jsonb(s));
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok',false,'error',SQLERRM); END $$;
