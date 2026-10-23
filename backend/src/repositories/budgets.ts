import type { Prisma, PrismaClient } from '@prisma/client';
import type { BudgetSearch } from '../validators/budgets';
import { createProcedureRepository } from './procedures';

export interface BudgetProcedure { id: string; name: string; description: string | null; defaultPrice: Prisma.Decimal | null }
export interface BudgetPatient { id: string; name: string }
export interface BudgetDentist { id: string; name: string; croNumber: string; croState: string }
export interface BudgetRepository {
  dentist(userId: string): Promise<BudgetDentist | null>;
  patients(userId: string, query: BudgetSearch): Promise<BudgetPatient[]>;
  patient(userId: string, patientId: string): Promise<BudgetPatient | null>;
  procedures(query: BudgetSearch): Promise<BudgetProcedure[]>;
  selectedProcedures(ids: string[]): Promise<BudgetProcedure[]>;
}
export function createBudgetRepository(db: PrismaClient): BudgetRepository {
  const patientScope = (userId: string) => ({ user: { role: 'PATIENT' as const, status: 'ACTIVE' as const }, appointments: { some: { status: { not: 'CANCELLED' as const }, dentist: { userId, user: { role: 'DENTIST' as const, status: 'ACTIVE' as const } } } } });
  const procedureSelect = { id: true, name: true, description: true, defaultPrice: true } as const;
  return {
    async dentist(userId) {
      const profile = await db.dentistProfile.findFirst({ where: { userId, user: { role: 'DENTIST', status: 'ACTIVE' } }, select: { id: true, croNumber: true, croState: true, user: { select: { name: true } } } });
      return profile ? { id: profile.id, name: profile.user.name, croNumber: profile.croNumber, croState: profile.croState } : null;
    },
    async patients(userId, query) {
      const rows = await db.patientProfile.findMany({ where: { ...patientScope(userId), user: { role: 'PATIENT', status: 'ACTIVE', name: { contains: query.search } } }, select: { id: true, user: { select: { name: true } } }, orderBy: [{ user: { name: 'asc' } }, { id: 'asc' }], skip: (query.page - 1) * query.pageSize, take: query.pageSize + 1 });
      return rows.map((row) => ({ id: row.id, name: row.user.name }));
    },
    async patient(userId, id) {
      const row = await db.patientProfile.findFirst({ where: { id, ...patientScope(userId) }, select: { id: true, user: { select: { name: true } } } });
      return row ? { id: row.id, name: row.user.name } : null;
    },
    procedures: (query) => createProcedureRepository(db).list(query, true),
    selectedProcedures: (ids) => db.procedure.findMany({ where: { id: { in: ids }, isActive: true }, select: procedureSelect }),
  };
}
