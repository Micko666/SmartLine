/**
 * Supabase Storage helpers for menu item images and business logos.
 *
 * Background: v1 stored images as base64 data URIs inside menu_items.image_url.
 * A restaurant with 38 items (~400 KB each) made the public get_customer_menu
 * RPC return ~17 MB per call — customer menus timed out and threw
 * "restaurant not found" errors.
 *
 * v2 (here): upload images to the `menu-images` bucket at
 *   {userId}/{itemId}.jpg            -- full (max 1200px, JPEG 85)
 *   {userId}/{itemId}_thumb.jpg      -- thumb (240px,  JPEG 80)
 *   {userId}/logo.jpg                -- logo  (400px,  JPEG 85)
 *
 * Database stores only the public URL (~120 bytes). Migration 007 strips
 * any leftover `data:` URIs from the RPC payload, so only real URLs flow
 * to customers; migrateBase64ToStorage() below converts existing rows.
 */

import { supabase } from './client';
import { isSupabaseEnabled } from '@/store/flags';

const BUCKET = 'menu-images';

export type ImageKind = 'full' | 'thumb' | 'logo';

// ── Compression ────────────────────────────────────────────────────────────

type CompressOpts = { maxDim: number; quality: number };

const PRESETS: Record<ImageKind, CompressOpts> = {
  full:  { maxDim: 1200, quality: 0.85 },
  thumb: { maxDim: 240,  quality: 0.80 },
  logo:  { maxDim: 400,  quality: 0.85 },
};

/**
 * Compress a File/Blob into a JPEG Blob of at most `maxDim` on its longest
 * side. Returns null if the image can't be decoded (non-image file, corrupt).
 */
export async function compressImage(
  source: Blob,
  kind: ImageKind,
): Promise<Blob | null> {
  const { maxDim, quality } = PRESETS[kind];

  const bitmap = await blobToBitmap(source);
  if (!bitmap) return null;

  const ratio = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * ratio);
  const h = Math.round(bitmap.height * ratio);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0, w, h);

  return new Promise<Blob | null>(resolve => {
    canvas.toBlob(b => resolve(b), 'image/jpeg', quality);
  });
}

async function blobToBitmap(source: Blob): Promise<ImageBitmap | null> {
  try {
    if ('createImageBitmap' in window) {
      return await createImageBitmap(source);
    }
  } catch {
    // fall through to HTMLImageElement
  }
  return await new Promise<ImageBitmap | null>(resolve => {
    const url = URL.createObjectURL(source);
    const img = new Image();
    img.onload = () => {
      // Cast via canvas — HTMLImageElement is drawable even if not a true ImageBitmap
      resolve(img as unknown as ImageBitmap);
      URL.revokeObjectURL(url);
    };
    img.onerror = () => { resolve(null); URL.revokeObjectURL(url); };
    img.src = url;
  });
}

// ── Upload / delete ────────────────────────────────────────────────────────

function pathFor(userId: string, itemId: string, kind: ImageKind): string {
  if (kind === 'logo')  return `${userId}/logo.jpg`;
  if (kind === 'thumb') return `${userId}/${itemId}_thumb.jpg`;
  return `${userId}/${itemId}.jpg`;
}

/**
 * Upload a compressed Blob to Storage and return its public URL.
 * Overwrites any existing object at the same path (upsert: true).
 */
export async function uploadBlob(
  blob: Blob,
  userId: string,
  itemId: string,
  kind: ImageKind,
): Promise<string | null> {
  if (!isSupabaseEnabled() || !supabase) return null;
  const path = pathFor(userId, itemId, kind);
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, blob, {
      contentType: 'image/jpeg',
      upsert: true,
      cacheControl: '31536000', // 1 year — paths are content-stable
    });
  if (error) {
    console.warn('[storage] upload failed', path, error.message);
    return null;
  }
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  // Cache-bust so overwrites become visible immediately.
  return `${data.publicUrl}?v=${Date.now()}`;
}

/**
 * Compress → upload full + thumb. Returns both public URLs or nulls on failure.
 */
export async function uploadMenuImage(
  file: Blob,
  userId: string,
  itemId: string,
): Promise<{ imageUrl: string | null; thumbnailUrl: string | null }> {
  const [full, thumb] = await Promise.all([
    compressImage(file, 'full'),
    compressImage(file, 'thumb'),
  ]);
  if (!full || !thumb) return { imageUrl: null, thumbnailUrl: null };
  const [imageUrl, thumbnailUrl] = await Promise.all([
    uploadBlob(full,  userId, itemId, 'full'),
    uploadBlob(thumb, userId, itemId, 'thumb'),
  ]);
  return { imageUrl, thumbnailUrl };
}

/**
 * Compress → upload a logo. One object per user, stable path.
 */
export async function uploadLogo(
  file: Blob,
  userId: string,
): Promise<string | null> {
  const out = await compressImage(file, 'logo');
  if (!out) return null;
  return uploadBlob(out, userId, 'logo', 'logo');
}

/**
 * Delete both full + thumb for a menu item. Best-effort; errors are logged.
 */
export async function deleteMenuImage(
  userId: string,
  itemId: string,
): Promise<void> {
  if (!isSupabaseEnabled() || !supabase) return;
  await supabase.storage
    .from(BUCKET)
    .remove([
      pathFor(userId, itemId, 'full'),
      pathFor(userId, itemId, 'thumb'),
    ]);
}

// ── Base64 → Storage migration ─────────────────────────────────────────────

/** `data:image/…;base64,…` → Blob. Returns null on malformed input. */
export function dataUriToBlob(uri: string): Blob | null {
  if (!uri.startsWith('data:')) return null;
  const match = /^data:([^;,]+)(?:;base64)?,(.*)$/.exec(uri);
  if (!match) return null;
  const [, mime, payload] = match;
  try {
    const bin = atob(payload);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime || 'image/jpeg' });
  } catch {
    return null;
  }
}

export type MigrationProgress = {
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  currentName?: string;
};

type MenuItemLike = {
  id: string;
  name: string;
  imageUrl?: string;
  thumbnailUrl?: string;
};

/**
 * Walks the current user's menu items, converts any `data:` image URLs to
 * Storage objects, and updates the corresponding rows via `onUpdate`.
 * Non-blocking: one item at a time, reports progress via `onProgress`.
 *
 * Safe to re-run — items already on https URLs are skipped.
 */
export async function migrateBase64ToStorage(
  items: MenuItemLike[],
  userId: string,
  onUpdate: (itemId: string, imageUrl: string, thumbnailUrl: string) => Promise<void>,
  onProgress?: (p: MigrationProgress) => void,
): Promise<MigrationProgress> {
  const targets = items.filter(i =>
    (i.imageUrl?.startsWith('data:') ?? false) ||
    (i.thumbnailUrl?.startsWith('data:') ?? false),
  );
  const progress: MigrationProgress = {
    total: targets.length,
    processed: 0,
    succeeded: 0,
    failed: 0,
  };
  onProgress?.(progress);

  for (const item of targets) {
    progress.currentName = item.name;
    onProgress?.(progress);

    const raw = item.imageUrl?.startsWith('data:')
      ? item.imageUrl
      : item.thumbnailUrl?.startsWith('data:')
        ? item.thumbnailUrl
        : null;

    const blob = raw ? dataUriToBlob(raw) : null;
    if (!blob) {
      progress.processed++;
      progress.failed++;
      onProgress?.({ ...progress });
      continue;
    }

    const { imageUrl, thumbnailUrl } = await uploadMenuImage(blob, userId, item.id);
    if (imageUrl && thumbnailUrl) {
      try {
        await onUpdate(item.id, imageUrl, thumbnailUrl);
        progress.succeeded++;
      } catch {
        progress.failed++;
      }
    } else {
      progress.failed++;
    }
    progress.processed++;
    onProgress?.({ ...progress });
  }

  progress.currentName = undefined;
  onProgress?.({ ...progress });
  return progress;
}
