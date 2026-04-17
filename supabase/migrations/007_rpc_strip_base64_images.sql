-- ============================================================
-- 007_rpc_strip_base64_images.sql
--
-- Base64 images stored in menu_items.image_url / thumbnail_url
-- were making the get_customer_menu RPC return 10-20 MB per call
-- (e.g. 38 items × ~400 KB each). This caused client timeouts
-- and "restaurant not found" errors on all public pages.
--
-- Fix: strip data: URIs in the RPC response — return empty string
-- so the UI falls back to the item's emoji icon. Real HTTPS URLs
-- (Supabase Storage, CDN) are returned unchanged.
-- ============================================================

DROP FUNCTION IF EXISTS get_customer_menu(text);

CREATE OR REPLACE FUNCTION get_customer_menu(p_restaurant_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id  uuid;
  v_settings jsonb;
  v_menu     jsonb;
  v_tables   jsonb;
BEGIN
  SELECT bs.user_id,
         jsonb_build_object(
           'business_name',           bs.business_name,
           'business_type',           bs.business_type,
           'currency',                bs.currency,
           'currency_symbol',         bs.currency_symbol,
           'tax_rate',                bs.tax_rate,
           'tax_display',             bs.tax_display,
           'language',                bs.language,
           'timezone',                bs.timezone,
           'opening_hours',           bs.opening_hours,
           'service_mode',            bs.service_mode,
           'low_stock_threshold',     bs.low_stock_threshold,
           'zero_stock_behavior',     bs.zero_stock_behavior,
           'app_url',                 bs.app_url,
           'logo_url',                CASE WHEN bs.logo_url LIKE 'data:%' THEN '' ELSE COALESCE(bs.logo_url,'') END,
           'restaurant_token',        bs.restaurant_token,
           'ordering_paused',         COALESCE(bs.ordering_paused, false),
           'ordering_paused_message', COALESCE(bs.ordering_paused_message, ''),
           'stations',                COALESCE(bs.stations, '[]'::jsonb)
         )
    INTO v_user_id, v_settings
    FROM business_settings bs
   WHERE bs.restaurant_token = p_restaurant_token;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false);
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id',               mi.id,
        'name',             mi.name,
        'description',      mi.description,
        'category',         mi.category,
        'price',            mi.price,
        'prep_time',        mi.prep_time,
        'stock',            mi.stock,
        'max_stock',        mi.max_stock,
        'status',           mi.status,
        'icon',             mi.icon,
        'image_url',        CASE WHEN mi.image_url LIKE 'data:%' THEN '' ELSE COALESCE(mi.image_url,'') END,
        'thumbnail_url',    CASE WHEN mi.thumbnail_url LIKE 'data:%' THEN '' ELSE COALESCE(mi.thumbnail_url,'') END,
        'tags',             COALESCE(mi.tags, '{}'),
        'modifiers',        COALESCE(mi.modifiers, '[]'::jsonb),
        'sort_order',       mi.sort_order,
        'sales_count',      mi.sales_count,
        'allergens',        mi.allergens,
        'dietary_tags',     mi.dietary_tags,
        'calories',         mi.calories,
        'cost_per_serving', mi.cost_per_serving,
        'recipe',           mi.recipe,
        'created_at',       mi.created_at,
        'updated_at',       mi.updated_at
      )
      ORDER BY mi.sort_order, mi.name
    ),
    '[]'::jsonb
  )
    INTO v_menu
    FROM menu_items mi
   WHERE mi.user_id = v_user_id
     AND mi.status != 'archived';

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id',         t.id,
        'number',     t.number,
        'name',       t.name,
        'capacity',   t.capacity,
        'status',     t.status,
        'shape',      COALESCE(t.shape, 'square'),
        'zone',       t.zone,
        'floor',      t.floor,
        'rotation',   COALESCE(t.rotation, 0),
        'x',          t.x,
        'y',          t.y,
        'size_scale', COALESCE(t.size_scale, 1),
        'created_at', t.created_at
      )
    ),
    '[]'::jsonb
  )
    INTO v_tables
    FROM tables t
   WHERE t.user_id = v_user_id;

  RETURN jsonb_build_object(
    'ok',        true,
    'userId',    v_user_id,
    'settings',  v_settings,
    'menuItems', v_menu,
    'tables',    v_tables
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_customer_menu(text) TO anon, authenticated;
