import { Prisma, type PrismaClient } from '@prisma/client';
import type { ProcedureEdit, ProcedureInput, ProcedureSearch } from '../validators/procedures';
import { HttpError } from '../utils/http-error';

export const procedureSelect = { id: true, name: true, description: true, defaultPrice: true, estimatedDurationMinutes: true, isActive: true, createdAt: true, updatedAt: true } satisfies Prisma.ProcedureSelect;
export type ProcedureRow = Prisma.ProcedureGetPayload<{ select: typeof procedureSelect }>;
export interface ProcedureRepository {
  list(query: ProcedureSearch, activeOnly: boolean): Promise<ProcedureRow[]>;
  create(input: ProcedureInput): Promise<ProcedureRow>;
  update(id: string, input: ProcedureEdit): Promise<ProcedureRow>;
  hasDentistProfile(userId: string): Promise<boolean>;
}
function writeData(input: ProcedureEdit) {
  return { ...input, ...(input.defaultPrice === undefined ? {} : { defaultPrice: input.defaultPrice === null ? null : new Prisma.Decimal(input.defaultPrice) }) };
}
export function createProcedureRepository(db: PrismaClient): ProcedureRepository {
  async function controlled<T>(work: () => Promise<T>) {
    try { return await work(); }
    catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2025') throw new HttpError(404, 'Procedimento não encontrado.');
        if (error.code === 'P2002') throw new HttpError(409, 'Já existe um registo com um identificador único informado.');
        if (['P2003', 'P2000'].includes(error.code)) throw new HttpError(400, 'Dados de procedimento inválidos.');
      }
      throw error;
    }
  }
  return {
    list: (query, activeOnly) => db.procedure.findMany({ where: { ...(activeOnly ? { isActive: true } : {}), name: { contains: query.search } }, select: procedureSelect, orderBy: [{ name: 'asc' }, { id: 'asc' }], skip: (query.page - 1) * query.pageSize, take: query.pageSize + 1 }),
    create: (input) => controlled(() => db.procedure.create({ data: { ...writeData(input), name: input.name, defaultPrice: input.defaultPrice == null ? null : new Prisma.Decimal(input.defaultPrice), estimatedDurationMinutes: input.estimatedDurationMinutes ?? null }, select: procedureSelect })),
    update: (id, input) => controlled(() => db.procedure.update({ where: { id }, data: writeData(input), select: procedureSelect })),
    hasDentistProfile: async (userId) => Boolean(await db.dentistProfile.findFirst({ where: { userId, user: { role: 'DENTIST', status: 'ACTIVE' } }, select: { id: true } })),
  };
}
