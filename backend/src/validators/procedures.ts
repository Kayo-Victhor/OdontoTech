import { z } from 'zod';

const optionalText = z.string().trim().max(2000).transform((value) => value || null).nullable();
export const procedurePriceSchema = z.string().regex(/^(0|[1-9]\d{0,7})(\.\d{1,2})?$/, 'Use um preço decimal não negativo com até duas casas.').nullable();
const fields = {
  name: z.string().trim().transform((value) => value.replace(/\s+/g, ' ')).pipe(z.string().min(2).max(191)),
  description: optionalText.optional(),
  defaultPrice: procedurePriceSchema.optional(),
  estimatedDurationMinutes: z.number().int().min(1).max(1440).nullable().optional(),
  isActive: z.boolean().optional(),
};
export const createProcedureSchema = z.object(fields).strict();
export const editProcedureSchema = createProcedureSchema.partial().refine((value) => Object.keys(value).length > 0);
export const procedureSearchSchema = z.object({ search: z.string().trim().max(80).default(''), page: z.coerce.number().int().min(1).max(100000).default(1), pageSize: z.coerce.number().int().min(1).max(50).default(20) }).strict();
export type ProcedureInput = z.infer<typeof createProcedureSchema>;
export type ProcedureEdit = z.infer<typeof editProcedureSchema>;
export type ProcedureSearch = z.infer<typeof procedureSearchSchema>;
