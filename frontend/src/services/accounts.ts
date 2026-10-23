import axios from 'axios';
import { api } from './api';
import type { SessionUser, UserRole } from '../auth/AuthProvider';

export interface AccountInput { name: string; email: string; password: string; confirmPassword: string }
export interface PatientInput extends AccountInput { phone?: string; birthDate?: string }
export type InternalInput = AccountInput & ({ role: 'RECEPTIONIST' } | { role: 'DENTIST'; croNumber: string; croState: string; specialty?: string });
export interface AdminUser { id: string; name: string; email: string; role: UserRole; status: 'ACTIVE' | 'INACTIVE'; createdAt: string }
export interface UserList { users: AdminUser[]; page: number; pageSize: number; total: number }
export function accountFields(form: FormData): AccountInput {
  return { name: String(form.get('name') || '').trim(), email: String(form.get('email') || '').trim().toLowerCase(), password: String(form.get('password') || ''), confirmPassword: String(form.get('confirmPassword') || '') };
}
export async function registerPatient(input: PatientInput) { return api.post<{ user: SessionUser }>('/auth/register', input); }
export function accountErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    if (error.response?.status === 409) return 'E-mail ou inscrição profissional já utilizados.';
    if (error.response?.status === 401) return 'A sessão expirou. Entre novamente.';
    if (error.response?.status === 403) return 'Acesso não autorizado. Apenas administradores podem gerir utilizadores.';
    if (error.response?.status === 400) return 'Verifique os campos, a senha e a confirmação informadas.';
    if (error.response?.status === 429) return 'Muitas tentativas. Aguarde antes de tentar novamente.';
  }
  return 'Não foi possível concluir o cadastro. Tente novamente.';
}
