-- Authoritative checkout; historical overloads are deliberately removed.
DROP FUNCTION IF EXISTS atomic_checkout(text,text,text,text,jsonb,text);
DROP FUNCTION IF EXISTS atomic_checkout(text,text,text,text,jsonb,text,text);

CREATE OR REPLACE FUNCTION ordering_time_allowed(p_hours jsonb,p_local timestamp)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
DECLARE d jsonb; prev jsonb; t time := p_local::time; BEGIN
 IF p_hours IS NULL OR p_hours='[]'::jsonb THEN RETURN true; END IF;
 SELECT x INTO d FROM jsonb_array_elements(p_hours) x WHERE (x->>'dayOfWeek')::int=extract(dow FROM p_local)::int;
 SELECT x INTO prev FROM jsonb_array_elements(p_hours) x WHERE (x->>'dayOfWeek')::int=(extract(dow FROM p_local)::int+6)%7;
 IF COALESCE((d->>'isOpen')::boolean,false) THEN
  IF (d->>'closeTime')::time>(d->>'openTime')::time AND t>=(d->>'openTime')::time AND t<(d->>'closeTime')::time THEN RETURN true; END IF;
  IF (d->>'closeTime')::time<=(d->>'openTime')::time AND t>=(d->>'openTime')::time THEN RETURN true; END IF;
 END IF;
 RETURN COALESCE((prev->>'isOpen')::boolean,false) AND (prev->>'closeTime')::time<=(prev->>'openTime')::time AND t<(prev->>'closeTime')::time;
END $$;

CREATE OR REPLACE FUNCTION checkout_result(p_order orders,p_receipt_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT jsonb_build_object('success',true,'orderId',p_order.id,'receiptId',p_receipt_id,
 'orderNumber',p_order.order_number,'tableName',p_order.table_name,'subtotal',p_order.subtotal,
 'taxRate',p_order.tax_rate,'taxAmount',p_order.tax_amount,'total',p_order.total,
 'estimatedPrepTime',p_order.estimated_prep_time,'items',p_order.items,'createdAt',p_order.created_at,
 'paymentStatus',p_order.payment_status,'status',p_order.status);
$$;

CREATE OR REPLACE FUNCTION atomic_checkout(
 p_restaurant_token text,p_session_id text,p_table_id text,p_payment_method text,p_cart jsonb,
 p_notes text,p_scheduled_for text,p_client_order_id uuid,
 p_customer_name text DEFAULT '',p_customer_phone text DEFAULT '',p_delivery_address text DEFAULT ''
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE
 s business_settings%ROWTYPE; item menu_items%ROWTYPE; ord orders%ROWTYPE;
 ci jsonb; sel jsonb; grp jsonb; opt jsonb; oid text; selected jsonb; resolved jsonb;
 items jsonb := '[]'; qty int; needed int; reserved int; count_sel int; option_ids jsonb;
 price numeric; subtotal numeric:=0; tax numeric; total numeric; max_prep int:=0;
 table_name text; channel text; local_time timestamp; instant timestamptz; zone text;
 receipt_id uuid:=gen_random_uuid(); requested_keys text[];
BEGIN
 SELECT * INTO s FROM business_settings WHERE restaurant_token=p_restaurant_token FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Restaurant not found'; END IF;
 IF p_client_order_id IS NULL THEN RAISE EXCEPTION 'An idempotency key is required'; END IF;
 -- Settings lock serializes this tenant, including retries and stock contention.
 SELECT * INTO ord FROM orders WHERE user_id=s.user_id AND client_order_id=p_client_order_id;
 IF FOUND THEN
  SELECT id INTO receipt_id FROM receipts WHERE order_id=ord.id LIMIT 1;
  RETURN checkout_result(ord,receipt_id);
 END IF;
 IF COALESCE(s.ordering_paused,false) THEN RAISE EXCEPTION 'Ordering is currently paused'; END IF;
 IF p_payment_method IS NULL OR p_payment_method NOT IN ('cash','card','google_pay','apple_pay') THEN RAISE EXCEPTION 'Invalid payment method'; END IF;
 IF jsonb_typeof(p_cart) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Cart must be an array'; END IF;
 IF jsonb_array_length(p_cart) NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'Cart must contain 1 to 50 lines'; END IF;
 IF length(COALESCE(p_notes,''))>2000 OR length(COALESCE(p_customer_name,''))>120 OR length(COALESCE(p_customer_phone,''))>40 OR length(COALESCE(p_delivery_address,''))>500 THEN RAISE EXCEPTION 'Customer field too long'; END IF;
 IF p_table_id IN ('takeaway','delivery') THEN
  channel:=p_table_id; table_name:=initcap(p_table_id);
  IF channel='takeaway' AND NOT COALESCE(s.takeaway_enabled,false) OR channel='delivery' AND NOT COALESCE(s.delivery_enabled,false) THEN RAISE EXCEPTION 'Ordering channel is disabled'; END IF;
  IF length(trim(COALESCE(p_customer_name,'')))=0 OR length(trim(COALESCE(p_customer_phone,'')))<5 THEN RAISE EXCEPTION 'Name and phone are required'; END IF;
  IF channel='delivery' AND length(trim(COALESCE(p_delivery_address,'')))<5 THEN RAISE EXCEPTION 'Delivery address is required'; END IF;
 ELSE
  channel:='dine-in';
  SELECT name INTO table_name FROM tables WHERE id=p_table_id::uuid AND user_id=s.user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Table not found'; END IF;
 END IF;
 zone:=COALESCE(NULLIF(s.timezone,''),'UTC');
 IF COALESCE(p_scheduled_for,'')<>'' THEN
  IF channel='dine-in' OR p_scheduled_for !~ '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$' THEN RAISE EXCEPTION 'Invalid scheduled time'; END IF;
  local_time:=p_scheduled_for::timestamp; instant:=local_time AT TIME ZONE zone;
  IF instant AT TIME ZONE zone <> local_time OR (instant-interval '1 hour') AT TIME ZONE zone=local_time OR (instant+interval '1 hour') AT TIME ZONE zone=local_time THEN RAISE EXCEPTION 'Ambiguous or nonexistent scheduled time'; END IF;
  IF instant<now()+interval '30 minutes' OR instant>now()+interval '90 days' THEN RAISE EXCEPTION 'Scheduled time must be 30 minutes to 90 days ahead'; END IF;
 ELSE local_time:=now() AT TIME ZONE zone; END IF;
 IF NOT ordering_time_allowed(s.business_hours,local_time) THEN RAISE EXCEPTION 'Restaurant is closed at the requested time'; END IF;
 -- PASS 1: validate every line and resolve all price-bearing data from DB.
 FOR ci IN SELECT value FROM jsonb_array_elements(p_cart) LOOP
  IF jsonb_typeof(ci) IS DISTINCT FROM 'object' OR jsonb_typeof(ci->'quantity') IS DISTINCT FROM 'number' OR (ci->>'quantity') !~ '^[1-9][0-9]*$' THEN RAISE EXCEPTION 'Quantity must be a positive integer'; END IF;
  qty:=(ci->>'quantity')::int;
  IF qty>100 THEN RAISE EXCEPTION 'Quantity exceeds 100'; END IF;
  SELECT * INTO item FROM menu_items WHERE id=(ci->>'menuItemId')::uuid AND user_id=s.user_id FOR UPDATE;
  IF NOT FOUND OR item.status<>'active' THEN RAISE EXCEPTION 'Item is unavailable'; END IF;
  SELECT sum((x->>'quantity')::int) INTO needed FROM jsonb_array_elements(p_cart) x WHERE x->>'menuItemId'=item.id::text;
  IF needed>100 THEN RAISE EXCEPTION 'Total item quantity exceeds 100'; END IF;
  SELECT COALESCE(sum((ri->>'quantity')::int),0) INTO reserved FROM stock_reservations r CROSS JOIN LATERAL jsonb_array_elements(r.items) ri WHERE r.user_id=s.user_id AND r.session_id IS DISTINCT FROM p_session_id AND r.expires_at>now() AND ri->>'menuItemId'=item.id::text;
  IF item.stock IS NOT NULL AND item.stock-reserved<needed THEN RAISE EXCEPTION 'Insufficient stock for %',item.name; END IF;
  selected:=COALESCE(ci->'selectedModifiers','[]'); resolved:='[]'; price:=item.price;
  IF jsonb_typeof(selected)<>'array' OR jsonb_array_length(selected)>50 THEN RAISE EXCEPTION 'Invalid modifier selections'; END IF;
  -- Normalize both grouped optionIds and the existing flat optionId UI model.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('modifierId',x->>'modifierId','optionId',v)), '[]') INTO selected
  FROM jsonb_array_elements(selected) x CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN x ? 'optionIds' THEN x->'optionIds' ELSE jsonb_build_array(x->>'optionId') END) v;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(selected) x GROUP BY x->>'modifierId',x->>'optionId' HAVING count(*)>1) THEN RAISE EXCEPTION 'Duplicate modifier selection'; END IF;
  FOR sel IN SELECT value FROM jsonb_array_elements(selected) LOOP
   SELECT x INTO grp FROM jsonb_array_elements(COALESCE(item.modifiers,'[]')) x WHERE x->>'id'=sel->>'modifierId';
   IF grp IS NULL THEN RAISE EXCEPTION 'Unknown modifier'; END IF;
   SELECT x INTO opt FROM jsonb_array_elements(grp->'options') x WHERE x->>'id'=sel->>'optionId';
   IF opt IS NULL THEN RAISE EXCEPTION 'Unknown modifier option'; END IF;
   price:=price+COALESCE((opt->>'priceAdjustment')::numeric,0);
   resolved:=resolved||jsonb_build_array(jsonb_build_object('modifierId',grp->>'id','modifierName',grp->>'name','optionId',opt->>'id','optionName',opt->>'name','priceAdjustment',COALESCE((opt->>'priceAdjustment')::numeric,0)));
  END LOOP;
  FOR grp IN SELECT value FROM jsonb_array_elements(COALESCE(item.modifiers,'[]')) LOOP
   SELECT count(*) INTO count_sel FROM jsonb_array_elements(selected) x WHERE x->>'modifierId'=grp->>'id';
   IF COALESCE((grp->>'required')::boolean,false) AND count_sel=0 THEN RAISE EXCEPTION 'Required modifier missing'; END IF;
   IF count_sel>COALESCE((grp->>'maxSelections')::int,1) THEN RAISE EXCEPTION 'Too many modifier selections'; END IF;
  END LOOP;
  IF price<0 THEN RAISE EXCEPTION 'Invalid configured item price'; END IF;
  price:=round(price,2); subtotal:=subtotal+price*qty; max_prep:=greatest(max_prep,COALESCE(item.prep_time,0));
  items:=items||jsonb_build_array(jsonb_build_object('menuItemId',item.id,'menuItemName',item.name,'menuItemIcon',item.icon,'category',item.category,'quantity',qty,'unitPrice',price,'modifiers',resolved,'lineTotal',price*qty));
 END LOOP;
 tax:=CASE WHEN s.tax_display='exclusive' THEN round(subtotal*COALESCE(s.tax_rate,0)/100,2) ELSE 0 END; total:=subtotal+tax;
 -- PASS 2: all mutations below share the function's transaction/subtransaction.
 FOR ci IN SELECT jsonb_build_object('id',x->>'menuItemId','quantity',sum((x->>'quantity')::int)) FROM jsonb_array_elements(items) x GROUP BY x->>'menuItemId' LOOP
  UPDATE menu_items SET stock=CASE WHEN stock IS NULL THEN NULL ELSE stock-(ci->>'quantity')::int END,sales_count=COALESCE(sales_count,0)+(ci->>'quantity')::int,updated_at=now() WHERE id=(ci->>'id')::uuid AND user_id=s.user_id;
 END LOOP;
 INSERT INTO orders(user_id,client_order_id,order_number,table_id,table_name,items,status,subtotal,tax_rate,tax_amount,total,payment_method,notes,scheduled_for,estimated_prep_time,prep_time_adjustment,customer_name,customer_phone,delivery_address,order_channel,payment_status,paid_at,last_actor)
 VALUES(s.user_id,p_client_order_id,s.next_order_number,p_table_id,table_name,items,'paid',subtotal,s.tax_rate,tax,total,p_payment_method,COALESCE(p_notes,''),NULLIF(p_scheduled_for,''),max_prep+greatest(0,jsonb_array_length(items)-1)*2,0,COALESCE(p_customer_name,''),COALESCE(p_customer_phone,''),COALESCE(p_delivery_address,''),channel,'unpaid',NULL,'customer') RETURNING * INTO ord;
 INSERT INTO receipts(id,user_id,order_id,order_number,table_id,table_name,restaurant_name,items,subtotal,tax_rate,tax_amount,total,payment_method,payment_status)
 VALUES(receipt_id,s.user_id,ord.id,ord.order_number,p_table_id,table_name,s.business_name,items,subtotal,s.tax_rate,tax,total,p_payment_method,'unpaid');
 UPDATE business_settings SET next_order_number=next_order_number+1 WHERE user_id=s.user_id;
 IF channel='dine-in' THEN UPDATE tables SET status='occupied' WHERE id=p_table_id::uuid AND user_id=s.user_id; END IF;
 DELETE FROM stock_reservations WHERE user_id=s.user_id AND (session_id=p_session_id OR expires_at<=now());
 RETURN checkout_result(ord,receipt_id);
EXCEPTION WHEN OTHERS THEN
 -- PL/pgSQL exception block rolls back every mutation before returning failure.
 RETURN jsonb_build_object('success',false,'error',SQLERRM,'unavailableItems','[]'::jsonb);
END $$;
