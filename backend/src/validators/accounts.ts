import { z } from 'zod';

export const emailSchema = z.string().trim().toLowerCase().max(254).email();
export const newPasswordSchema = z.string().min(12).max(128)
  .regex(/[a-z]/).regex(/[A-Z]/).regex(/[0-9]/).regex(/[^A-Za-z0-9]/);
const commonFields = {
  name: z.string().trim().min(2).max(120),
  email: emailSchema,
  password: newPasswordSchema,
  confirmPassword: z.string().min(1).max(128),
};
const matchingPasswords = (data: { password: string; confirmPassword: string }) => data.password === data.confirmPassword;
const birthDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value &&
    value >= '0001-01-01' && value <= new Date().toISOString().slice(0, 10);
});
export const patientRegistrationSchema = z.object({
  ...commonFields,
  phone: z.string().trim().max(30).regex(/^\+?[0-9 ().-]+$/)
    .refine((value) => { const count = value.replace(/\D/g, '').length; return count >= 8 && count <= 15; }).optional(),
  birthDate: birthDate.optional(),
}).strict().refine(matchingPasswords, { path: ['confirmPassword'], message: 'As senhas devem coincidir.' });

export const internalUserSchema = z.discriminatedUnion('role', [
  z.object({ ...commonFields, role: z.literal('RECEPTIONIST') }).strict(),
  z.object({
    ...commonFields, role: z.literal('DENTIST'),
    croNumber: z.string().trim().min(1).max(30).regex(/^[A-Za-z0-9.-]+$/).transform((value) => value.toUpperCase()),
    croState: z.string().trim().length(2).regex(/^[A-Za-z]{2}$/).transform((value) => value.toUpperCase()),
    specialty: z.string().trim().min(1).max(120).optional(),
  }).strict(),
]).refine(matchingPasswords, { path: ['confirmPassword'], message: 'As senhas devem coincidir.' });

export const listUsersSchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
}).strict();
export type PatientRegistration = z.infer<typeof patientRegistrationSchema>;
export type InternalUserInput = z.infer<typeof internalUserSchema>;
