import {
  Prisma,
  type PrismaClient,
  type AppointmentStatus,
} from "@prisma/client";
import type { PublicUser } from "../services/auth";
import type { OptionQuery } from "../validators/appointments";
import { HttpError } from "../utils/http-error";

export const appointmentSelect = {
  id: true,
  patientId: true,
  dentistId: true,
  startAt: true,
  endAt: true,
  status: true,
  reason: true,
  cancellationReason: true,
  patient: {
    select: { id: true, userId: true, user: { select: { name: true } } },
  },
  dentist: {
    select: { id: true, userId: true, user: { select: { name: true } } },
  },
} satisfies Prisma.AppointmentSelect;
export type AppointmentRow = Prisma.AppointmentGetPayload<{
  select: typeof appointmentSelect;
}>;
export interface AppointmentWrite {
  patientId: string;
  dentistId: string;
  startAt: Date;
  endAt: Date;
  reason: string | null;
}
export interface AppointmentTransaction {
  find(id: string): Promise<AppointmentRow | null>;
  patientExists(id: string): Promise<boolean>;
  dentistExists(id: string): Promise<boolean>;
  overlaps(
    dentistId: string,
    startAt: Date,
    endAt: Date,
    excludeId?: string,
  ): Promise<boolean>;
  insert(
    data: AppointmentWrite & { createdById: string; status: "SCHEDULED" },
  ): Promise<AppointmentRow>;
  update(
    id: string,
    data: Partial<AppointmentWrite> & {
      status?: AppointmentStatus;
      cancellationReason?: string;
    },
  ): Promise<AppointmentRow>;
}
export interface AppointmentRepository {
  find(id: string): Promise<AppointmentRow | null>;
  list(filter: {
    start: Date;
    end: Date;
    actor: PublicUser;
    dentistId?: string;
    status?: AppointmentStatus;
  }): Promise<AppointmentRow[]>;
  options(
    query: OptionQuery,
  ): Promise<{ items: { id: string; name: string }[]; hasMore: boolean }>;
  transaction<T>(
    dentistIds: string[],
    appointmentId: string | undefined,
    work: (tx: AppointmentTransaction) => Promise<T>,
  ): Promise<T>;
}
function transactionAdapter(
  tx: Prisma.TransactionClient,
): AppointmentTransaction {
  return {
    find: (id) =>
      tx.appointment.findUnique({ where: { id }, select: appointmentSelect }),
    patientExists: async (id) =>
      Boolean(
        await tx.patientProfile.findFirst({
          where: { id, user: { role: "PATIENT", status: "ACTIVE" } },
          select: { id: true },
        }),
      ),
    dentistExists: async (id) =>
      Boolean(
        await tx.dentistProfile.findFirst({
          where: { id, user: { role: "DENTIST", status: "ACTIVE" } },
          select: { id: true },
        }),
      ),
    overlaps: async (dentistId, startAt, endAt, excludeId) =>
      Boolean(
        await tx.appointment.findFirst({
          where: {
            dentistId,
            status: { not: "CANCELLED" },
            startAt: { lt: endAt },
            endAt: { gt: startAt },
            ...(excludeId ? { id: { not: excludeId } } : {}),
          },
          select: { id: true },
        }),
      ),
    insert: (data) =>
      tx.appointment.create({ data, select: appointmentSelect }),
    update: (id, data) =>
      tx.appointment.update({ where: { id }, data, select: appointmentSelect }),
  };
}
export function createAppointmentRepository(
  database: PrismaClient,
): AppointmentRepository {
  return {
    find: (id) =>
      database.appointment.findUnique({
        where: { id },
        select: appointmentSelect,
      }),
    list: ({ start, end, actor, dentistId, status }) =>
      database.appointment.findMany({
        where: {
          startAt: { lt: end },
          endAt: { gt: start },
          ...(dentistId ? { dentistId } : {}),
          ...(status ? { status } : {}),
          ...(actor.role === "PATIENT"
            ? { patient: { userId: actor.id } }
            : {}),
          ...(actor.role === "DENTIST"
            ? { dentist: { userId: actor.id } }
            : {}),
        },
        select: appointmentSelect,
        orderBy: [{ startAt: "asc" }, { id: "asc" }],
      }),
    async options(query) {
      const args = {
        where: {
          user: {
            role:
              query.kind === "patients"
                ? ("PATIENT" as const)
                : ("DENTIST" as const),
            status: "ACTIVE" as const,
            name: { contains: query.search },
          },
        },
        select: { id: true, user: { select: { name: true } } },
        orderBy: { id: "asc" as const },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize + 1,
      };
      const profiles =
        query.kind === "patients"
          ? await database.patientProfile.findMany(args)
          : await database.dentistProfile.findMany(args);
      return {
        items: profiles
          .slice(0, query.pageSize)
          .map((p) => ({ id: p.id, name: p.user.name })),
        hasMore: profiles.length > query.pageSize,
      };
    },
    async transaction(dentistIds, appointmentId, work) {
      try {
        return await database.$transaction(
          async (tx) => {
            // Tabelas físicas verificadas no schema (sem @@map). Mesma ordem em TODAS as escritas.
            for (const id of [...new Set(dentistIds)].sort()) {
              const rows = await tx.$queryRaw<
                { id: string }[]
              >`SELECT id FROM DentistProfile WHERE id = ${id} FOR UPDATE`;
              if (!rows.length)
                throw new HttpError(400, "Dentista inexistente.");
            }
            if (appointmentId)
              await tx.$queryRaw`SELECT id FROM Appointment WHERE id = ${appointmentId} FOR UPDATE`;
            return work(transactionAdapter(tx));
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
            maxWait: 5000,
            timeout: 10000,
          },
        );
      } catch (error: unknown) {
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          if (
            ["P2034", "P2028"].includes(error.code) ||
            (error.code === "P2010" &&
              ["1205", "1213"].includes(String(error.meta?.code)))
          )
            throw new HttpError(
              409,
              "A agenda está a ser alterada. Atualize e tente novamente.",
            );
          if (error.code === "P2003")
            throw new HttpError(400, "Paciente ou dentista inválido.");
          if (error.code === "P2025")
            throw new HttpError(404, "Consulta não encontrada.");
        }
        throw error;
      }
    },
  };
}
