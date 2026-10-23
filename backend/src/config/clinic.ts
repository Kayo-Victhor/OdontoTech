import { DateTime, IANAZone } from "luxon";
import { HttpError } from "../utils/http-error";

export interface ClinicConfig {
  timeZone: string;
  startHour: number;
  endHour: number;
  slotMinutes: number;
}
export function readClinicConfig(
  env: NodeJS.ProcessEnv = process.env,
): ClinicConfig {
  const timeZone = env.CLINIC_TIMEZONE || "America/Sao_Paulo";
  const startHour = Number(env.AGENDA_START_HOUR ?? 8);
  const endHour = Number(env.AGENDA_END_HOUR ?? 18);
  const slotMinutes = Number(env.AGENDA_SLOT_MINUTES ?? 60);
  if (
    !IANAZone.isValidZone(timeZone) ||
    !Number.isInteger(startHour) ||
    !Number.isInteger(endHour) ||
    startHour < 0 ||
    endHour > 24 ||
    endHour <= startHour ||
    !Number.isInteger(slotMinutes) ||
    slotMinutes < 5 ||
    slotMinutes > 120
  ) {
    throw new Error("Configuração de fuso/horários da clínica inválida.");
  }
  return { timeZone, startHour, endHour, slotMinutes };
}
export function clinicDay(date: string, config: ClinicConfig) {
  const start = DateTime.fromISO(date, { zone: config.timeZone }).startOf(
    "day",
  );
  if (!start.isValid || start.year < 1000 || start.toISODate() !== date)
    throw new HttpError(400, "Data de agenda inválida.");
  return {
    start: start.toUTC().toJSDate(),
    end: start.plus({ days: 1 }).toUTC().toJSDate(),
  };
}
