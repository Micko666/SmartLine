import { supabase } from '../client';
import { mapIngredientRow, ingredientToRow } from '../mappers';
import type { Ingredient } from '@/domain/types';

export async function fetchIngredients(userId: string): Promise<Ingredient[]> {
  const { data, error } = await supabase!
    .from('ingredients')
    .select('*')
    .eq('user_id', userId)
    .order('name', { ascending: true });
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map(mapIngredientRow);
}

export async function insertIngredient(ing: Ingredient, userId: string): Promise<void> {
  const row = ingredientToRow(ing, userId);
  const { error } = await supabase!.from('ingredients').insert({
    ...row,
    created_at: ing.createdAt,
    updated_at: ing.updatedAt,
  });
  if (error) throw new Error(error.message);
}

export async function updateIngredientRow(
  id: string,
  updates: Partial<Record<string, unknown>>,
): Promise<void> {
  const { error } = await supabase!
    .from('ingredients')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

export async function deleteIngredientRow(id: string): Promise<void> {
  const { error } = await supabase!.from('ingredients').delete().eq('id', id);
  if (error) throw new Error(error.message);
}
