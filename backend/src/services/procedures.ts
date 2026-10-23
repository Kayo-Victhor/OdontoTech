import type { ProcedureRepository, ProcedureRow } from '../repositories/procedures';
import type { ProcedureInput, ProcedureEdit, ProcedureSearch } from '../validators/procedures';
import type { PublicUser } from './auth';
import { HttpError } from '../utils/http-error';

export const procedureDto = (row: ProcedureRow) => ({ ...row, defaultPrice: row.defaultPrice?.toFixed(2) ?? null });
export function createProcedureService(repository: ProcedureRepository) {
  function requireAdmin(actor: PublicUser) { if (actor.role !== 'ADMIN') throw new HttpError(403, 'Apenas administradores podem gerir o catálogo.'); }
  return {
    async list(query: ProcedureSearch, actor: PublicUser, administrative = false) {
      if (administrative) requireAdmin(actor);
      else if (actor.role !== 'ADMIN' && !(actor.role === 'DENTIST' && await repository.hasDentistProfile(actor.id))) throw new HttpError(403, 'Acesso ao catálogo não autorizado.');
      const rows = await repository.list(query, !administrative);
      return { items: rows.slice(0, query.pageSize).map(procedureDto), hasMore: rows.length > query.pageSize };
    },
    async create(input: ProcedureInput, actor: PublicUser) { requireAdmin(actor); return procedureDto(await repository.create(input)); },
    async update(id: string, input: ProcedureEdit, actor: PublicUser) { requireAdmin(actor); return procedureDto(await repository.update(id, input)); },
  };
}
