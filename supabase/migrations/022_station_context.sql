-- ============================================================
-- 022_station_context
--
-- Station devices need floor-map and category data that the public
-- customer menu intentionally no longer returns (019). This session-gated
-- RPC returns exactly what station screens render: active menu items
-- (for category filtering and production summaries), tables with floor
-- layout and live status, and map decorations.
-- ============================================================

CREATE OR REPLACE FUNCTION station_get_context(p_session_token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE st stations%ROWTYPE; bs business_settings%ROWTYPE; v_menu jsonb; v_tables jsonb; v_decorations jsonb;
BEGIN
  st := station_require_session(p_session_token);
  SELECT * INTO bs FROM business_settings WHERE user_id = st.user_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name, 'category', m.category, 'icon', m.icon,
      'prep_time', m.prep_time, 'status', m.status, 'price', m.price, 'modifiers', COALESCE(m.modifiers, '[]'::jsonb),
      'sort_order', m.sort_order) ORDER BY m.sort_order, m.name), '[]'::jsonb)
    INTO v_menu FROM menu_items m WHERE m.user_id = st.user_id AND m.status <> 'archived';

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', t.id, 'number', t.number, 'name', t.name, 'capacity', t.capacity,
      'status', t.status, 'shape', t.shape, 'zone', t.zone, 'floor', t.floor, 'rotation', t.rotation,
      'x', t.x, 'y', t.y, 'size_scale', t.size_scale, 'created_at', t.created_at) ORDER BY t.number), '[]'::jsonb)
    INTO v_tables FROM tables t WHERE t.user_id = st.user_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', d.id, 'type', d.type, 'x', d.x, 'y', d.y, 'w', d.w, 'h', d.h,
      'floor', d.floor, 'rotation', d.rotation)), '[]'::jsonb)
    INTO v_decorations FROM map_decorations d WHERE d.user_id = st.user_id;

  RETURN jsonb_build_object('ok', true, 'restaurantName', bs.business_name, 'currencySymbol', bs.currency_symbol,
    'timezone', bs.timezone, 'station', station_public_json(st),
    'menuItems', v_menu, 'tables', v_tables, 'decorations', v_decorations);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END $$;

REVOKE ALL ON FUNCTION station_get_context(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION station_get_context(text) TO anon, authenticated;
