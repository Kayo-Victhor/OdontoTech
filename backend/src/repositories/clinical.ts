import { Prisma, type PrismaClient } from "@prisma/client";
import type { ClinicalPage } from "../validators/clinical";
import { HttpError } from "../utils/http-error";

const identity = { id: true, name: true, role: true, status: true } as const;
export const clinicalAppointmentSelect = {
  id: true,
  patientId: true,
  dentistId: true,
  startAt: true,
  endAt: true,
  status: true,
  patient: {
    select: {
      id: true,
      phone: true,
      birthDate: true,
      user: { select: identity },
    },
  },
  dentist: { select: { id: true, user: { select: identity } } },
} satisfies Prisma.AppointmentSelect;
export const clinicalRecordSelect = {
  id: true,
  appointmentId: true,
  authorId: true,
  notes: true,
  finalizedAt: true,
  createdAt: true,
  updatedAt: true,
  author: { select: { name: true } },
  procedures: {
    select: {
      id: true,
      procedureNameSnapshot: true,
      toothOrRegion: true,
      descriptionSnapshot: true,
      notes: true,
      createdAt: true,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  },
  addenda: {
    select: {
      id: true,
      content: true,
      createdAt: true,
      author: { select: { name: true } },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  },
} satisfies Prisma.ClinicalRecordSelect;
export type ClinicalAppointment = Prisma.AppointmentGetPayload<{
  select: typeof clinicalAppointmentSelect;
}>;
export type ClinicalRow = Prisma.ClinicalRecordGetPayload<{
  select: typeof clinicalRecordSelect;
}>;
export type ClinicalHistoryRow = ClinicalRow & {
  appointment: ClinicalAppointment;
};
export interface ClinicalTransaction {
  appointment(id: string): Promise<ClinicalAppointment | null>;
  record(appointmentId: string): Promise<ClinicalRow | null>;
  start(appointmentId: string, authorId: string): Promise<ClinicalRow>;
  save(
    id: string,
    data: { notes?: string; finalizedAt?: Date; updatedAt: Date },
  ): Promise<ClinicalRow>;
  catalogItem(
    id: string,
  ): Promise<{ name: string; description: string | null } | null>;
  addProcedure(
    recordId: string,
    data: {
      procedureId?: string;
      procedureNameSnapshot: string;
      toothOrRegion: string;
      descriptionSnapshot: string | null;
      notes: string | null;
    },
  ): Promise<void>;
  addendum(recordId: string, authorId: string, content: string): Promise<void>;
}
export interface ClinicalRepository {
  appointment(id: string): Promise<ClinicalAppointment | null>;
  record(appointmentId: string): Promise<ClinicalRow | null>;
  history(
    scope:
      | { patientUserId: string }
      | { patientId: string; dentistUserId: string },
    page: ClinicalPage,
  ): Promise<ClinicalHistoryRow[]>;
  catalog(
    query: ClinicalPage & { search: string },
  ): Promise<{ id: string; name: string }[]>;
  transaction<T>(
    dentistId: string,
    appointmentId: string,
    work: (tx: ClinicalTransaction) => Promise<T>,
  ): Promise<T>;
}
function adapter(tx: Prisma.TransactionClient): ClinicalTransaction {
  return {
    appointment: (id) =>
      tx.appointment.findUnique({
        where: { id },
        select: clinicalAppointmentSelect,
      }),
    record: (appointmentId) =>
      tx.clinicalRecord.findUnique({
        where: { appointmentId },
        select: clinicalRecordSelect,
      }),
    start: (appointmentId, authorId) =>
      tx.clinicalRecord.create({
        data: { appointmentId, authorId, notes: "" },
        select: clinicalRecordSelect,
      }),
    save: (id, data) =>
      tx.clinicalRecord.update({
        where: { id },
        data,
        select: clinicalRecordSelect,
      }),
    catalogItem: (id) =>
      tx.procedure.findFirst({
        where: { id, isActive: true },
        select: { name: true, description: true },
      }),
    addProcedure: async (clinicalRecordId, data) => {
      await tx.clinicalProcedure.create({
        data: { clinicalRecordId, ...data },
      });
    },
    addendum: async (clinicalRecordId, authorId, content) => {
      await tx.clinicalAddendum.create({
        data: { clinicalRecordId, authorId, content },
      });
    },
  };
}
export function createClinicalRepository(db: PrismaClient): ClinicalRepository {
  return {
    ...adapter(db),
    history: (scope, page) =>
      db.clinicalRecord.findMany({
        where: {
          ...("patientUserId" in scope
            ? {
                finalizedAt: { not: null },
                appointment: {
                  patient: {
                    userId: scope.patientUserId,
                    user: { role: "PATIENT" },
                  },
                },
              }
            : {
                appointment: {
                  patientId: scope.patientId,
                  dentist: {
                    userId: scope.dentistUserId,
                    user: { role: "DENTIST", status: "ACTIVE" },
                  },
                },
              }),
        },
        select: {
          ...clinicalRecordSelect,
          appointment: { select: clinicalAppointmentSelect },
        },
        orderBy: [{ appointment: { startAt: "desc" } }, { id: "desc" }],
        skip: (page.page - 1) * page.pageSize,
        take: page.pageSize + 1,
      }),
    catalog: (query) =>
      db.procedure.findMany({
        where: { isActive: true, name: { contains: query.search } },
        select: { id: true, name: true },
        orderBy: [{ name: "asc" }, { id: "asc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize + 1,
      }),
    async transaction(dentistId, appointmentId, work) {
      try {
        return await db.$transaction(
          async (tx) => {
            // Mesmo protocolo da agenda: dentista -> consulta -> prontuário. Sem @@map no schema.
            await tx.$queryRaw`SELECT id FROM DentistProfile WHERE id = ${dentistId} FOR UPDATE`;
            await tx.$queryRaw`SELECT id FROM Appointment WHERE id = ${appointmentId} FOR UPDATE`;
            await tx.$queryRaw`SELECT id FROM ClinicalRecord WHERE appointmentId = ${appointmentId} FOR UPDATE`;
            return work(adapter(tx));
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
            maxWait: 5000,
            timeout: 10000,
          },
        );
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          if (
            ["P2002", "P2034", "P2028"].includes(error.code) ||
            (error.code === "P2010" &&
              ["1205", "1213"].includes(String(error.meta?.code)))
          )
            throw new HttpError(
              409,
              "Registo alterado ou ocupado. Atualize e tente novamente.",
            );
          if (error.code === "P2003")
            throw new HttpError(400, "Referência clínica inválida.");
          if (error.code === "P2025")
            throw new HttpError(404, "Registo não encontrado.");
        }
        throw error;
      }
    },
  };
}
