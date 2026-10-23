import { Prisma } from '@prisma/client';
import type { ClinicConfig } from '../config/clinic';
import type { BudgetProcedure, BudgetRepository } from '../repositories/budgets';
import type { BudgetSearch, BudgetSimulationInput } from '../validators/budgets';
import type { PublicUser } from './auth';
import { HttpError } from '../utils/http-error';

export const simulationNotice = 'Estimativa de tratamento, sem juros. Não constitui pagamento, recibo, fatura ou compromisso financeiro. Valores e condições devem ser confirmados com a clínica.';
export function installmentPlan(total: Prisma.Decimal, count: number) {
  if (!Number.isInteger(count) || count < 1 || count > 12 || total.isNegative()) throw new HttpError(400, 'Parcelamento inválido.');
  const rounded = total.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  const regular = rounded.div(count).toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN);
  const last = rounded.minus(regular.mul(count - 1));
  return { count, regularAmount: regular.toFixed(2), lastAmount: last.toFixed(2), adjustment: last.minus(regular).toFixed(2), amounts: Array.from({ length: count }, (_, index) => (index === count - 1 ? last : regular).toFixed(2)) };
}
export function createBudgetService(repository: BudgetRepository, clinic: ClinicConfig) {
  async function dentist(actor: PublicUser) {
    if (actor.role !== 'DENTIST') throw new HttpError(403, 'Simulações são restritas ao dentista.');
    const profile = await repository.dentist(actor.id);
    if (!profile) throw new HttpError(403, 'Perfil profissional ativo não encontrado.');
    return profile;
  }
  const priced = (procedure: BudgetProcedure) => ({ id: procedure.id, name: procedure.name, description: procedure.description, unitPrice: procedure.defaultPrice?.toFixed(2) ?? null });
  return {
    async patients(actor: PublicUser, query: BudgetSearch) {
      await dentist(actor); const rows = await repository.patients(actor.id, query);
      return { items: rows.slice(0, query.pageSize), hasMore: rows.length > query.pageSize };
    },
    async procedures(actor: PublicUser, query: BudgetSearch) {
      await dentist(actor); const rows = await repository.procedures(query);
      return { items: rows.slice(0, query.pageSize).map(priced), hasMore: rows.length > query.pageSize, currency: 'BRL' };
    },
    async simulate(actor: PublicUser, input: BudgetSimulationInput) {
      const professional = await dentist(actor);
      const [patient, procedures] = await Promise.all([repository.patient(actor.id, input.patientId), repository.selectedProcedures(input.items.map((item) => item.procedureId))]);
      if (!patient) throw new HttpError(404, 'Paciente não encontrado ou não autorizado.');
      const byId = new Map(procedures.map((item) => [item.id, item]));
      const items = input.items.map((item) => {
        const procedure = byId.get(item.procedureId);
        if (!procedure) throw new HttpError(400, 'Procedimento inexistente ou inativo.');
        if (procedure.defaultPrice === null) throw new HttpError(409, 'Há procedimentos sem preço configurado no catálogo.');
        const unitPrice = procedure.defaultPrice.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
        return { procedureId: procedure.id, name: procedure.name, description: procedure.description, quantity: item.quantity, unitPrice: unitPrice.toFixed(2), subtotal: unitPrice.mul(item.quantity).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2) };
      });
      const total = items.reduce((sum, item) => sum.plus(item.subtotal), new Prisma.Decimal(0));
      return { clinicName: 'OdontoTech', createdAt: new Date().toISOString(), timeZone: clinic.timeZone, patient, dentist: professional, items, total: total.toFixed(2), currency: 'BRL', selectedInstallments: input.installments,
        plans: [...new Set([1, 3, 6, 12, input.installments])].sort((a, b) => a - b).map((count) => installmentPlan(total, count)), persisted: false, notice: simulationNotice };
    },
  };
}
