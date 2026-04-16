import { supabase } from '../client';
import { mapEmployeeRow, employeeToRow } from '../mappers';
import type { Employee } from '@/domain/types';

export async function fetchEmployees(userId: string): Promise<Employee[]> {
  const { data, error } = await supabase!
    .from('employees')
    .select('*')
    .eq('user_id', userId)
    .order('name', { ascending: true });
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map(mapEmployeeRow);
}

export async function insertEmployee(emp: Employee, userId: string): Promise<void> {
  const { error } = await supabase!.from('employees').insert(employeeToRow(emp, userId));
  if (error) throw new Error(error.message);
}

export async function updateEmployeeRow(
  id: string,
  updates: Partial<Record<string, unknown>>,
): Promise<void> {
  const { error } = await supabase!.from('employees').update(updates).eq('id', id);
  if (error) throw new Error(error.message);
}

export async function deleteEmployeeRow(id: string): Promise<void> {
  const { error } = await supabase!.from('employees').delete().eq('id', id);
  if (error) throw new Error(error.message);
}
