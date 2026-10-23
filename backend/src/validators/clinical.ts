import { z } from 'zod';

const text = (max: number) => z.string().trim().min(1).max(max).refine((value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value));
export const clinicalVersion = z.string().datetime({ precision: 3 });
export const draftSchema = z.object({ notes: z.string().max(4000), expectedUpdatedAt: clinicalVersion }).strict();
export const finalizeSchema = z.object({ expectedUpdatedAt: clinicalVersion }).strict();
export const startRecordSchema = z.object({}).strict();
export const procedureSchema = z.object({
  expectedUpdatedAt: clinicalVersion,
  procedureId: text(191).optional(),
  procedureName: text(191).optional(),
  toothOrRegion: text(80),
  description: text(2000).optional(),
  notes: text(2000).optional(),
}).strict().refine((value) => Boolean(value.procedureId || value.procedureName));
export const addendumSchema = z.object({ content: text(4000) }).strict();
export const clinicalPageSchema = z.object({ page: z.coerce.number().int().min(1).max(100000).default(1), pageSize: z.coerce.number().int().min(1).max(50).default(10) }).strict();
export const catalogSchema = clinicalPageSchema.extend({ search: z.string().trim().max(100).default('') });
export type ClinicalPage = z.infer<typeof clinicalPageSchema>;
export type ClinicalProcedureInput = z.infer<typeof procedureSchema>;
