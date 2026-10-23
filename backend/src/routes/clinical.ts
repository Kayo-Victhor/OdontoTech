import { Router } from "express";
import type { z } from "zod";
import type { AuthConfig } from "../config/auth";
import type { ClinicConfig } from "../config/clinic";
import { authenticate, authorize } from "../middlewares/auth";
import type { ClinicalRepository } from "../repositories/clinical";
import { createClinicalService } from "../services/clinical";
import type { AuthService, PublicUser } from "../services/auth";
import {
  addendumSchema,
  catalogSchema,
  clinicalPageSchema,
  draftSchema,
  finalizeSchema,
  procedureSchema,
  startRecordSchema,
} from "../validators/clinical";
import { HttpError } from "../utils/http-error";

export function createClinicalRoutes(
  config: AuthConfig,
  auth: AuthService,
  repository: ClinicalRepository,
  clinic: ClinicConfig,
) {
  const router = Router();
  router.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  router.use(authenticate(auth, config), authorize("DENTIST", "PATIENT"));
  const service = createClinicalService(repository);
  const actor = (res: { locals: Record<string, unknown> }) =>
    res.locals.user as PublicUser;
  function parse<T>(schema: z.ZodType<T>, value: unknown): T {
    const result = schema.safeParse(value);
    if (!result.success)
      throw new HttpError(
        400,
        "Dados clínicos inválidos. Verifique os campos e os limites indicados.",
      );
    return result.data;
  }
  router.get("/history", authorize("PATIENT"), async (req, res) => {
    res.json({
      ...(await service.history(
        undefined,
        actor(res),
        parse(clinicalPageSchema, req.query),
      )),
      timeZone: clinic.timeZone,
    });
  });
  router.get("/catalog", authorize("DENTIST"), async (req, res) => {
    const query = parse(catalogSchema, req.query);
    const items = await repository.catalog(query);
    res.json({
      items: items.slice(0, query.pageSize),
      hasMore: items.length > query.pageSize,
    });
  });
  router.use("/appointments", authorize("DENTIST"));
  router.get("/appointments/:id/history", async (req, res) => {
    res.json({
      ...(await service.history(
        String(req.params.id),
        actor(res),
        parse(clinicalPageSchema, req.query),
      )),
      timeZone: clinic.timeZone,
    });
  });
  router.get("/appointments/:id", async (req, res) => {
    res.json({
      ...(await service.get(String(req.params.id), actor(res))),
      timeZone: clinic.timeZone,
    });
  });
  router.post("/appointments/:id", async (req, res) => {
    parse(startRecordSchema, req.body);
    res.json({
      record: await service.start(String(req.params.id), actor(res)),
    });
  });
  router.patch("/appointments/:id", async (req, res) => {
    res.json({
      record: await service.save(
        String(req.params.id),
        parse(draftSchema, req.body),
        actor(res),
      ),
    });
  });
  router.post("/appointments/:id/procedures", async (req, res) => {
    res
      .status(201)
      .json({
        record: await service.addProcedure(
          String(req.params.id),
          parse(procedureSchema, req.body),
          actor(res),
        ),
      });
  });
  router.post("/appointments/:id/finalize", async (req, res) => {
    const input = parse(finalizeSchema, req.body);
    res.json({
      record: await service.finalize(
        String(req.params.id),
        input.expectedUpdatedAt,
        actor(res),
      ),
    });
  });
  router.post("/appointments/:id/addenda", async (req, res) => {
    const input = parse(addendumSchema, req.body);
    res
      .status(201)
      .json({
        record: await service.addendum(
          String(req.params.id),
          input.content,
          actor(res),
        ),
      });
  });
  return router;
}
