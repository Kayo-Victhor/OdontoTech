import { z } from 'zod';

const id = z.string().trim().min(1).max(191);
export const budgetSearchSchema = z.object({ search: z.string().trim().max(80).default(''), page: z.coerce.number().int().min(1).max(100000).default(1), pageSize: z.coerce.number().int().min(1).max(50).default(20) }).strict();
export const budgetSimulationSchema = z.object({
  patientId: id,
  items: z.array(z.object({ procedureId: id, quantity: z.number().int().min(1).max(100) }).strict()).min(1).max(50),
  installments: z.number().int().min(1).max(12),
}).strict().refine((value) => new Set(value.items.map((item) => item.procedureId)).size === value.items.length);
export type BudgetSearch = z.infer<typeof budgetSearchSchema>;
export type BudgetSimulationInput = z.infer<typeof budgetSimulationSchema>;
