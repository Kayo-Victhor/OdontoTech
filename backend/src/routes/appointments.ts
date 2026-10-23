import { Router } from "express";
import type { AuthConfig } from "../config/auth";
import type { ClinicConfig } from "../config/clinic";
import type { AuthService, PublicUser } from "../services/auth";
import type { AppointmentRepository } from "../repositories/appointments";
import { authenticate, authorize } from "../middlewares/auth";
import { createAppointmentService } from "../services/appointments";
import {
  appointmentOptionsSchema,
  appointmentStatusSchema,
  createAppointmentSchema,
  dailyAgendaSchema,
  editAppointmentSchema,
} from "../validators/appointments";
import { HttpError } from "../utils/http-error";

export function createAppointmentRoutes(
  authConfig: AuthConfig,
  auth: AuthService,
  repository: AppointmentRepository,
  clinic: ClinicConfig,
) {
  const router = Router();
  router.use(authenticate(auth, authConfig));
  router.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  const service = createAppointmentService(repository, clinic);
  const actor = (res: { locals: Record<string, unknown> }) =>
    res.locals.user as PublicUser;
  router.get("/config", (_req, res) => {
    res.json(clinic);
  });
  router.get(
    "/options",
    authorize("ADMIN", "RECEPTIONIST"),
    async (req, res) => {
      const query = appointmentOptionsSchema.safeParse(req.query);
      if (!query.success)
        throw new HttpError(400, "Pesquisa de perfis inválida.");
      res.json(await repository.options(query.data));
    },
  );
  router.get("/", async (req, res) => {
    const query = dailyAgendaSchema.safeParse(req.query);
    if (!query.success)
      throw new HttpError(
        400,
        "Informe uma data válida e filtros reconhecidos.",
      );
    res.json({ appointments: await service.list(query.data, actor(res)) });
  });
  router.get("/:id", async (req, res) => {
    res.json({
      appointment: await service.get(String(req.params.id), actor(res)),
    });
  });
  router.post("/", authorize("ADMIN", "RECEPTIONIST"), async (req, res) => {
    const data = createAppointmentSchema.safeParse(req.body);
    if (!data.success)
      throw new HttpError(
        400,
        "Dados de agendamento inválidos. Envie horários ISO com fuso explícito.",
      );
    res
      .status(201)
      .json({ appointment: await service.create(data.data, actor(res)) });
  });
  router.patch(
    "/:id/status",
    authorize("ADMIN", "RECEPTIONIST", "DENTIST"),
    async (req, res) => {
      const data = appointmentStatusSchema.safeParse(req.body);
      if (!data.success) throw new HttpError(400, "Dados de estado inválidos.");
      res.json({
        appointment: await service.changeStatus(
          String(req.params.id),
          data.data,
          actor(res),
        ),
      });
    },
  );
  router.patch("/:id", authorize("ADMIN", "RECEPTIONIST"), async (req, res) => {
    const data = editAppointmentSchema.safeParse(req.body);
    if (!data.success) throw new HttpError(400, "Campos de edição inválidos.");
    res.json({
      appointment: await service.edit(
        String(req.params.id),
        data.data,
        actor(res),
      ),
    });
  });
  return router;
}
