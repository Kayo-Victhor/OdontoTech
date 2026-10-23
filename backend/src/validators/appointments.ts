import { z } from "zod";
import { DateTime } from "luxon";

export const appointmentStatuses = [
  "SCHEDULED",
  "CONFIRMED",
  "WAITING",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
  "NO_SHOW",
] as const;
const id = z.string().trim().min(1).max(191);
const instant = z
  .string()
  .max(40)
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/,
  )
  .refine((value) => { const date = DateTime.fromISO(value, { setZone: true }); return date.isValid && date.year >= 1000; });
const fields = {
  patientId: id,
  dentistId: id,
  startAt: instant,
  endAt: instant,
  reason: z.string().trim().max(1000).nullable().optional(),
};
export const createAppointmentSchema = z.object(fields).strict();
export const editAppointmentSchema = z
  .object(fields)
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0);
export const appointmentStatusSchema = z
  .object({
    status: z.enum(appointmentStatuses),
    cancellationReason: z.string().trim().min(1).max(1000).optional(),
  })
  .strict();
export const dailyAgendaSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    dentistId: id.optional(),
    status: z.enum(appointmentStatuses).optional(),
  })
  .strict();
export const appointmentOptionsSchema = z
  .object({
    kind: z.enum(["patients", "dentists"]),
    search: z.string().trim().max(80).default(""),
    page: z.coerce.number().int().min(1).max(100000).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();
export type CreateAppointmentInput = z.infer<typeof createAppointmentSchema>;
export type EditAppointmentInput = z.infer<typeof editAppointmentSchema>;
export type StatusInput = z.infer<typeof appointmentStatusSchema>;
export type AgendaQuery = z.infer<typeof dailyAgendaSchema>;
export type OptionQuery = z.infer<typeof appointmentOptionsSchema>;
