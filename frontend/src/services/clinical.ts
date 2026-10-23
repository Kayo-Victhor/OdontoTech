import axios from 'axios';
import { DateTime } from 'luxon';
import type { AppointmentStatus } from './appointments';

export interface ClinicalRecord {
  id: string; appointmentId: string; notes: string; finalizedAt: string | null; createdAt: string; updatedAt: string; author: { name: string };
  procedures: { id: string; procedureNameSnapshot: string; toothOrRegion: string; descriptionSnapshot: string | null; notes: string | null; createdAt: string }[];
  addenda: { id: string; content: string; createdAt: string; author: { name: string } }[];
}
export interface ClinicalAppointment {
  id: string; startAt: string; endAt: string; status: AppointmentStatus;
  patient: { id: string; name: string; birthDate: string | null; phone: string | null }; dentist: { name: string };
}
export interface ClinicalContext { appointment: ClinicalAppointment; record: ClinicalRecord | null; timeZone: string }
export interface ClinicalHistory { items: (ClinicalRecord & { appointment: ClinicalAppointment })[]; hasMore: boolean; timeZone: string }
export function clinicalError(error: unknown) {
  if (axios.isAxiosError(error)) {
    switch (error.response?.status) {
      case 400: return 'Verifique os campos. A finalização exige notas e pelo menos um procedimento.';
      case 401: return 'A sessão expirou. Entre novamente.';
      case 403: return 'Não tem permissão para aceder ao conteúdo clínico.';
      case 404: return 'Consulta ou registo não encontrado, ou sem permissão de acesso.';
      case 409: return 'Registo alterado, finalizado ou estado da consulta incompatível. Recarregue os dados antes de continuar.';
    }
  }
  return 'Não foi possível carregar ou guardar os dados clínicos. Tente novamente.';
}
export const clinicalDate = (instant: string, zone: string) => DateTime.fromISO(instant).setZone(zone).toFormat('dd/MM/yyyy HH:mm');
