import { supabase } from '../client';
import type { MapDecoration } from '@/domain/types';

function mapRow(row: Record<string, unknown>): MapDecoration {
  return {
    id:       row.id as string,
    type:     row.type as MapDecoration['type'],
    x:        Number(row.x ?? 0),
    y:        Number(row.y ?? 0),
    w:        Number(row.w ?? 48),
    h:        Number(row.h ?? 48),
    floor:    (row.floor as string | undefined) ?? undefined,
    rotation: Number(row.rotation ?? 0),
  };
}

export async function fetchDecorations(userId: string): Promise<MapDecoration[]> {
  const { data, error } = await supabase!
    .from('map_decorations')
    .select('*')
    .eq('user_id', userId);
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map(mapRow);
}

export async function insertDecoration(dec: MapDecoration, userId: string): Promise<void> {
  const { error } = await supabase!.from('map_decorations').insert({
    id: dec.id, user_id: userId,
    type: dec.type, x: dec.x, y: dec.y, w: dec.w, h: dec.h,
    floor: dec.floor ?? null, rotation: dec.rotation,
  });
  if (error) throw new Error(error.message);
}

export async function updateDecorationRow(
  id: string,
  updates: Partial<Record<string, unknown>>,
): Promise<void> {
  const { error } = await supabase!.from('map_decorations').update(updates).eq('id', id);
  if (error) throw new Error(error.message);
}

export async function deleteDecorationRow(id: string): Promise<void> {
  const { error } = await supabase!.from('map_decorations').delete().eq('id', id);
  if (error) throw new Error(error.message);
}
