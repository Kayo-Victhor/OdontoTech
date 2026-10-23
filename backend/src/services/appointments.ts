import type { AppointmentStatus } from '@prisma/client';
import { clinicDay, type ClinicConfig } from '../config/clinic';
import type { AppointmentRepository, AppointmentRow, AppointmentTransaction, AppointmentWrite } from '../repositories/appointments';
import type { AgendaQuery, CreateAppointmentInput, EditAppointmentInput, StatusInput } from '../validators/appointments';
import type { PublicUser } from './auth';
import { HttpError } from '../utils/http-error';

export const transitions: Record<AppointmentStatus, AppointmentStatus[]> = {
  SCHEDULED: ['CONFIRMED', 'CANCELLED'], CONFIRMED: ['WAITING', 'CANCELLED', 'NO_SHOW'],
  WAITING: ['IN_PROGRESS', 'CANCELLED'], IN_PROGRESS: ['COMPLETED'], COMPLETED: [], CANCELLED: [], NO_SHOW: [],
};
export function operational(actor: PublicUser) { return actor.role === 'ADMIN' || actor.role === 'RECEPTIONIST'; }
function requireOperational(actor: PublicUser) { if (!operational(actor)) throw new HttpError(403, 'Acesso não autorizado.'); }
function visible(row: AppointmentRow, actor: PublicUser) {
  return operational(actor) || (actor.role === 'DENTIST' && row.dentist.userId === actor.id) || (actor.role === 'PATIENT' && row.patient.userId === actor.id);
}
export function appointmentDto(row: AppointmentRow) {
  return { id: row.id, patientId: row.patientId, dentistId: row.dentistId, startAt: row.startAt, endAt: row.endAt, status: row.status, reason: row.reason, cancellationReason: row.cancellationReason,
    patient: { id: row.patient.id, name: row.patient.user.name }, dentist: { id: row.dentist.id, name: row.dentist.user.name } };
}
async function validateWrite(tx: AppointmentTransaction, input: AppointmentWrite, excludeId?: string) {
  if (!Number.isFinite(input.startAt.getTime()) || !Number.isFinite(input.endAt.getTime()) || input.endAt <= input.startAt) throw new HttpError(400, 'O término deve ser posterior ao início.');
  if (!await tx.patientExists(input.patientId)) throw new HttpError(400, 'Paciente inexistente, inativo ou com perfil inválido.');
  if (!await tx.dentistExists(input.dentistId)) throw new HttpError(400, 'Dentista inexistente, inativo ou com perfil inválido.');
  if (await tx.overlaps(input.dentistId, input.startAt, input.endAt, excludeId)) throw new HttpError(409, 'Já existe uma consulta neste intervalo para o dentista.');
}
export function createAppointmentService(repository: AppointmentRepository, config: ClinicConfig) {
  async function find(id: string, actor: PublicUser) {
    const row = await repository.find(id);
    if (!row || !visible(row, actor)) throw new HttpError(404, 'Consulta não encontrada.');
    return row;
  }
  return {
    async create(input: CreateAppointmentInput, actor: PublicUser) {
      requireOperational(actor);
      return repository.transaction([input.dentistId], undefined, async (tx) => {
        const data: AppointmentWrite = { patientId: input.patientId, dentistId: input.dentistId, startAt: new Date(input.startAt), endAt: new Date(input.endAt), reason: input.reason || null };
        await validateWrite(tx, data);
        return appointmentDto(await tx.insert({ ...data, createdById: actor.id, status: 'SCHEDULED' }));
      });
    },
    async list(query: AgendaQuery, actor: PublicUser) {
      if (query.dentistId && !operational(actor)) throw new HttpError(403, 'O filtro por profissional é restrito à recepção e administração.');
      return (await repository.list({ ...clinicDay(query.date, config), actor, dentistId: query.dentistId, status: query.status })).map(appointmentDto);
    },
    async get(id: string, actor: PublicUser) { return appointmentDto(await find(id, actor)); },
    async edit(id: string, input: EditAppointmentInput, actor: PublicUser) {
      requireOperational(actor);
      const snapshot = await find(id, actor);
      return repository.transaction([snapshot.dentistId, input.dentistId || snapshot.dentistId], id, async (tx) => {
        const row = await tx.find(id);
        if (!row) throw new HttpError(404, 'Consulta não encontrada.');
        if (row.dentistId !== snapshot.dentistId) throw new HttpError(409, 'Consulta alterada por outra operação. Atualize a agenda.');
        if (!['SCHEDULED', 'CONFIRMED'].includes(row.status)) throw new HttpError(409, 'Este estado não permite editar o agendamento.');
        const data: AppointmentWrite = { patientId: input.patientId ?? row.patientId, dentistId: input.dentistId ?? row.dentistId,
          startAt: input.startAt ? new Date(input.startAt) : row.startAt, endAt: input.endAt ? new Date(input.endAt) : row.endAt,
          reason: input.reason === undefined ? row.reason : input.reason || null };
        await validateWrite(tx, data, id);
        return appointmentDto(await tx.update(id, data));
      });
    },
    async changeStatus(id: string, input: StatusInput, actor: PublicUser) {
      if (actor.role === 'PATIENT') throw new HttpError(403, 'Acesso não autorizado.');
      const snapshot = await find(id, actor);
      return repository.transaction([snapshot.dentistId], id, async (tx) => {
        const row = await tx.find(id);
        if (!row || !visible(row, actor)) throw new HttpError(404, 'Consulta não encontrada.');
        if (row.dentistId !== snapshot.dentistId) throw new HttpError(409, 'Consulta alterada por outra operação. Atualize a agenda.');
        if (actor.role === 'DENTIST' && !((row.status === 'WAITING' && input.status === 'IN_PROGRESS') || (row.status === 'IN_PROGRESS' && input.status === 'COMPLETED'))) throw new HttpError(403, 'O dentista só pode iniciar e concluir as próprias consultas.');
        if (!transitions[row.status].includes(input.status)) throw new HttpError(409, 'Transição de estado não permitida.');
        if (input.cancellationReason && input.status !== 'CANCELLED') throw new HttpError(400, 'Motivo de cancelamento só é permitido ao cancelar.');
        return appointmentDto(await tx.update(id, { status: input.status, ...(input.status === 'CANCELLED' ? { cancellationReason: input.cancellationReason } : {}) }));
      });
    },
  };
}
