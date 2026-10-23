import axios from "axios";
import { DateTime } from "luxon";

export type AppointmentStatus =
  | "SCHEDULED"
  | "CONFIRMED"
  | "WAITING"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "CANCELLED"
  | "NO_SHOW";
export interface ClinicConfig {
  timeZone: string;
  startHour: number;
  endHour: number;
  slotMinutes: number;
}
export interface ProfileOption {
  id: string;
  name: string;
}
export interface Appointment {
  id: string;
  patientId: string;
  dentistId: string;
  startAt: string;
  endAt: string;
  status: AppointmentStatus;
  reason: string | null;
  cancellationReason: string | null;
  patient: ProfileOption;
  dentist: ProfileOption;
}
export const statusNames: Record<AppointmentStatus, string> = {
  SCHEDULED: "Agendado",
  CONFIRMED: "Confirmado",
  WAITING: "Em espera",
  IN_PROGRESS: "Em atendimento",
  COMPLETED: "Concluído",
  CANCELLED: "Cancelado",
  NO_SHOW: "Falta",
};
export const statusTransitions: Record<AppointmentStatus, AppointmentStatus[]> =
  {
    SCHEDULED: ["CONFIRMED", "CANCELLED"],
    CONFIRMED: ["WAITING", "CANCELLED", "NO_SHOW"],
    WAITING: ["IN_PROGRESS", "CANCELLED"],
    IN_PROGRESS: ["COMPLETED"],
    COMPLETED: [],
    CANCELLED: [],
    NO_SHOW: [],
  };
export function appointmentError(error: unknown) {
  if (axios.isAxiosError(error)) {
    switch (error.response?.status) {
      case 400:
        return "Verifique os perfis e os horários. O término deve ser posterior ao início.";
      case 401:
        return "A sessão expirou. Entre novamente.";
      case 403:
        return "Não tem permissão para esta operação.";
      case 404:
        return "Consulta não encontrada ou sem permissão de acesso.";
      case 409:
        return "Conflito de horário ou consulta alterada. A agenda foi atualizada; reveja os dados.";
    }
  }
  return "Não foi possível carregar ou atualizar a agenda. Tente novamente.";
}
export function clinicInstant(date: string, time: string, zone: string) {
  const local = `${date}T${time}`;
  const value = DateTime.fromISO(local, { zone });
  if (
    !value.isValid ||
    value.toFormat("yyyy-MM-dd'T'HH:mm") !== local ||
    value.getPossibleOffsets().length !== 1
  )
    throw new Error(
      "Horário inexistente ou ambíguo no fuso da clínica. Escolha outro horário.",
    );
  return value.toUTC().toISO()!;
}
export function formatTime(instant: string, zone: string) {
  return DateTime.fromISO(instant).setZone(zone).toFormat("HH:mm");
}
export function agendaSlots(
  date: string,
  config: ClinicConfig,
  appointments: Appointment[],
) {
  const day = DateTime.fromISO(date, { zone: config.timeZone }).startOf("day");
  const start = day.set({ hour: config.startHour });
  const end =
    config.endHour === 24
      ? day.plus({ days: 1 })
      : day.set({ hour: config.endHour });
  const slots = [];
  for (
    let cursor = start;
    cursor < end;
    cursor = cursor.plus({ minutes: config.slotMinutes })
  ) {
    const next = DateTime.min(
      cursor.plus({ minutes: config.slotMinutes }),
      end,
    );
    slots.push({
      id: cursor.toISO()!,
      label: cursor.toFormat("HH:mm"),
      start: cursor.toMillis(),
      end: next.toMillis(),
      appointments: appointments.filter(
        (a) =>
          Date.parse(a.startAt) >= cursor.toMillis() &&
          Date.parse(a.startAt) < next.toMillis(),
      ),
      occupied: appointments.some(
        (a) =>
          a.status !== "CANCELLED" &&
          Date.parse(a.startAt) < next.toMillis() &&
          Date.parse(a.endAt) > cursor.toMillis(),
      ),
    });
  }
  const outside = appointments.filter(
    (a) =>
      Date.parse(a.startAt) < start.toMillis() ||
      Date.parse(a.startAt) >= end.toMillis(),
  );
  return { slots, outside };
}
