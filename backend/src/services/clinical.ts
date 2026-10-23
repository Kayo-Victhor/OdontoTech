import type { ClinicalAppointment, ClinicalRepository, ClinicalRow, ClinicalTransaction } from '../repositories/clinical';
import type { ClinicalPage, ClinicalProcedureInput } from '../validators/clinical';
import type { PublicUser } from './auth';
import { HttpError } from '../utils/http-error';

export const clinicalEligibleStatuses = ['IN_PROGRESS', 'COMPLETED'];
function dentistAccess(appointment: ClinicalAppointment | null, actor: PublicUser): asserts appointment is ClinicalAppointment {
  if (actor.role !== 'DENTIST') throw new HttpError(403, 'Acesso clínico não autorizado.');
  if (!appointment || appointment.dentist.user.id !== actor.id || appointment.dentist.user.role !== 'DENTIST' || appointment.dentist.user.status !== 'ACTIVE') throw new HttpError(404, 'Consulta não encontrada.');
  if (appointment.patient.user.role !== 'PATIENT') throw new HttpError(409, 'A consulta não possui um perfil de paciente válido.');
}
export function clinicalDto(row: ClinicalRow) {
  const { authorId: _authorId, ...data } = row;
  return data;
}
export function clinicalContext(appointment: ClinicalAppointment) {
  return { id: appointment.id, startAt: appointment.startAt, endAt: appointment.endAt, status: appointment.status,
    patient: { id: appointment.patient.id, name: appointment.patient.user.name, birthDate: appointment.patient.birthDate?.toISOString().slice(0, 10) ?? null, phone: appointment.patient.phone },
    dentist: { name: appointment.dentist.user.name } };
}
function requireDraft(row: ClinicalRow | null, appointment: ClinicalAppointment, expected: string): asserts row is ClinicalRow {
  if (!row) throw new HttpError(404, 'Inicie o rascunho antes de guardar.');
  if (row.finalizedAt) throw new HttpError(409, 'Registo finalizado. Utilize um aditamento.');
  if (!clinicalEligibleStatuses.includes(appointment.status)) throw new HttpError(409, 'O estado da consulta não permite registo clínico.');
  if (row.updatedAt.toISOString() !== expected) throw new HttpError(409, 'O rascunho foi alterado. Atualize antes de guardar novamente.');
}
// Versão monotónica mesmo quando duas escritas ocorrem no mesmo milissegundo.
const nextVersion = (row: ClinicalRow) => new Date(Math.max(Date.now(), row.updatedAt.getTime() + 1));
export function createClinicalService(repository: ClinicalRepository) {
  async function appointment(id: string, actor: PublicUser) {
    const value = await repository.appointment(id); dentistAccess(value, actor); return value;
  }
  async function write<T>(id: string, actor: PublicUser, work: (tx: ClinicalTransaction, context: ClinicalAppointment, record: ClinicalRow | null) => Promise<T>) {
    const snapshot = await appointment(id, actor);
    return repository.transaction(snapshot.dentistId, id, async (tx) => {
      const context = await tx.appointment(id); dentistAccess(context, actor);
      if (context.dentistId !== snapshot.dentistId) throw new HttpError(409, 'Consulta alterada. Atualize antes de continuar.');
      const row = await tx.record(id);
      if (row && row.appointmentId !== context.id) throw new HttpError(409, 'Relação clínica inválida.');
      return work(tx, context, row);
    });
  }
  return {
    async get(id: string, actor: PublicUser) {
      const context = await appointment(id, actor);
      const row = await repository.record(id);
      return { appointment: clinicalContext(context), record: row ? clinicalDto(row) : null };
    },
    start(id: string, actor: PublicUser) {
      return write(id, actor, async (tx, context, row) => {
        if (row) return clinicalDto(row);
        if (!clinicalEligibleStatuses.includes(context.status)) throw new HttpError(409, 'Só pode iniciar um registo em consultas em atendimento ou concluídas.');
        return clinicalDto(await tx.start(id, actor.id));
      });
    },
    save(id: string, input: { notes: string; expectedUpdatedAt: string }, actor: PublicUser) {
      return write(id, actor, async (tx, context, row) => {
        requireDraft(row, context, input.expectedUpdatedAt);
        return clinicalDto(await tx.save(row.id, { notes: input.notes, updatedAt: nextVersion(row) }));
      });
    },
    addProcedure(id: string, input: ClinicalProcedureInput, actor: PublicUser) {
      return write(id, actor, async (tx, context, row) => {
        requireDraft(row, context, input.expectedUpdatedAt);
        const catalog = input.procedureId ? await tx.catalogItem(input.procedureId) : null;
        if (input.procedureId && !catalog) throw new HttpError(400, 'Procedimento de catálogo inexistente ou inativo.');
        await tx.addProcedure(row.id, { procedureId: input.procedureId, procedureNameSnapshot: catalog?.name ?? input.procedureName!, toothOrRegion: input.toothOrRegion,
          descriptionSnapshot: input.description ?? catalog?.description ?? null, notes: input.notes ?? null });
        return clinicalDto(await tx.save(row.id, { updatedAt: nextVersion(row) }));
      });
    },
    finalize(id: string, expectedUpdatedAt: string, actor: PublicUser) {
      return write(id, actor, async (tx, context, row) => {
        requireDraft(row, context, expectedUpdatedAt);
        if (!row.notes.trim() || !row.procedures.length) throw new HttpError(400, 'A finalização exige notas clínicas e pelo menos um procedimento.');
        return clinicalDto(await tx.save(row.id, { finalizedAt: new Date(), updatedAt: nextVersion(row) }));
      });
    },
    addendum(id: string, content: string, actor: PublicUser) {
      return write(id, actor, async (tx, _context, row) => {
        if (!row || !row.finalizedAt) throw new HttpError(409, 'Aditamentos só são permitidos em registos finalizados.');
        await tx.addendum(row.id, actor.id, content);
        return clinicalDto((await tx.record(id))!);
      });
    },
    async history(id: string | undefined, actor: PublicUser, page: ClinicalPage) {
      let scope: Parameters<ClinicalRepository['history']>[0];
      if (actor.role === 'PATIENT' && id === undefined) scope = { patientUserId: actor.id };
      else if (actor.role === 'DENTIST' && id) scope = { patientId: (await appointment(id, actor)).patientId, dentistUserId: actor.id };
      else throw new HttpError(403, 'Acesso clínico não autorizado.');
      const rows = await repository.history(scope, page);
      return { items: rows.slice(0, page.pageSize).map((row) => ({ ...clinicalDto(row), appointment: clinicalContext(row.appointment) })), hasMore: rows.length > page.pageSize };
    },
  };
}
