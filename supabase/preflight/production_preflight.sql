-- Read-only preflight for migrations 015-024 on an existing database.
-- Every value must be 0 (except informational counts marked "info").
-- Last run against production: 2026-09-27, all zero.
SELECT
  (SELECT count(*) FROM (SELECT user_id, order_number FROM orders GROUP BY 1, 2 HAVING count(*) > 1) d) AS dup_order_numbers,       -- 015 unique index
  (SELECT count(*) FROM orders WHERE status = 'served')                                                                  AS served_orders,           -- 015 maps to completed (info)
  (SELECT count(*) FROM orders WHERE payment_method IS NULL OR payment_method NOT IN ('cash','card','google_pay','apple_pay')) AS bad_payment_method,  -- 023
  (SELECT count(*) FROM menu_items WHERE price < 0 OR stock < 0 OR max_stock < 0)                                        AS negative_menu_values,    -- 023
  (SELECT count(*) FROM calendar_events WHERE guest_count <= 0)                                                          AS nonpositive_guests,      -- 023
  (SELECT count(*) FROM event_packages WHERE min_guests <= 0 OR max_guests < min_guests)                                 AS bad_package_ranges,      -- 023
  (SELECT count(*) FROM tables WHERE shape IS NULL OR rotation IS NULL OR size_scale IS NULL)                            AS null_table_layout,       -- 015 SET NOT NULL
  (SELECT count(*) FROM business_settings bs,
     jsonb_array_elements(CASE WHEN jsonb_typeof(bs.stations) = 'array' THEN bs.stations ELSE '[]'::jsonb END) s
   WHERE NOT (s->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))                             AS non_uuid_station_ids,    -- 018 backfill keeps ids
  (SELECT count(*) FROM business_settings WHERE timezone IS NULL OR timezone = '' OR timezone NOT IN (SELECT name FROM pg_timezone_names)) AS invalid_timezones,
  (SELECT count(*) FROM orders WHERE status IN ('paid','preparing','ready'))                                             AS active_orders_info,      -- deploy when 0 if possible
  (SELECT count(*) FROM orders WHERE table_id IN ('takeaway','delivery'))                                                AS channel_backfill_info,   -- 015 sets order_channel (info)
  (SELECT count(*) FROM business_settings bs,
     jsonb_array_elements(CASE WHEN jsonb_typeof(bs.stations) = 'array' THEN bs.stations ELSE '[]'::jsonb END) s
   WHERE s->'permissions'->'visibleStatuses' ? 'paid')                                                                    AS station_paid_status_info; -- 024 maps to placed (info)
