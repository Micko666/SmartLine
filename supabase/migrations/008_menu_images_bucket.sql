-- ============================================================
-- 008_menu_images_bucket.sql
--
-- Creates the `menu-images` Storage bucket used for menu item
-- photos + business logos. Moves us off base64 data URIs (which
-- bloated the get_customer_menu RPC to 17MB) onto public-read
-- object storage (CDN-served, cached, and out-of-line from SQL).
--
-- Layout convention (enforced in src/lib/supabase/storage.ts):
--   menu-images/{userId}/{itemId}.jpg           -- full image
--   menu-images/{userId}/{itemId}_thumb.jpg     -- 240px thumb
--   menu-images/{userId}/logo.jpg               -- business logo
--
-- Access model:
--   - anon + authenticated can READ any object (public menus)
--   - authenticated can INSERT/UPDATE/DELETE only within their
--     own `{auth.uid()}/...` prefix
-- ============================================================

-- 1. Create the bucket (idempotent)
INSERT INTO storage.buckets (id, name, public)
VALUES ('menu-images', 'menu-images', true)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

-- 2. Policies — drop-and-recreate so this migration is re-runnable
DROP POLICY IF EXISTS "menu-images read"   ON storage.objects;
DROP POLICY IF EXISTS "menu-images insert" ON storage.objects;
DROP POLICY IF EXISTS "menu-images update" ON storage.objects;
DROP POLICY IF EXISTS "menu-images delete" ON storage.objects;

CREATE POLICY "menu-images read"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'menu-images');

CREATE POLICY "menu-images insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'menu-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "menu-images update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'menu-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'menu-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "menu-images delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'menu-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
