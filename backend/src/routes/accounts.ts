import { Router } from "express";
import type { AuthConfig } from "../config/auth";
import type { AuthService } from "../services/auth";
import type { AccountRepository } from "../repositories/accounts";
import { createAccountService } from "../services/accounts";
import { authenticate, authorize } from "../middlewares/auth";
import { attemptLimiter } from "../middlewares/rate-limit";
import {
  internalUserSchema,
  listUsersSchema,
  patientRegistrationSchema,
} from "../validators/accounts";
import { HttpError } from "../utils/http-error";

export function createAccountRoutes(
  config: AuthConfig,
  auth: AuthService,
  repository?: AccountRepository,
) {
  const router = Router();
  const service = repository ? createAccountService(repository) : null;
  router.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  router.post(
    "/auth/register",
    attemptLimiter(
      config.registrationLimit ?? 5,
      config.registrationWindowMs ?? 900000,
    ),
    async (req, res) => {
      const parsed = patientRegistrationSchema.safeParse(req.body);
      if (!parsed.success)
        throw new HttpError(
          400,
          "Verifique os campos. Use uma senha de 12 a 128 caracteres, com maiúscula, minúscula, número e símbolo, e confirme-a.",
        );
      if (!service)
        throw new HttpError(503, "Cadastro temporariamente indisponível.");
      res
        .status(201)
        .json({ user: await service.registerPatient(parsed.data) });
    },
  );
  router.use("/admin", authenticate(auth, config), authorize("ADMIN"));
  router.post("/admin/users", async (req, res) => {
    const parsed = internalUserSchema.safeParse(req.body);
    if (!parsed.success)
      throw new HttpError(
        400,
        "Verifique os dados, a senha e os campos de CRO exigidos para dentistas. Apenas rececionistas e dentistas podem ser criados aqui.",
      );
    if (!service)
      throw new HttpError(
        503,
        "Gestão de utilizadores temporariamente indisponível.",
      );
    res.status(201).json({ user: await service.createInternal(parsed.data) });
  });
  router.get("/admin/users", async (req, res) => {
    const parsed = listUsersSchema.safeParse(req.query);
    if (!parsed.success) throw new HttpError(400, "Paginação inválida.");
    if (!service)
      throw new HttpError(
        503,
        "Gestão de utilizadores temporariamente indisponível.",
      );
    res.json(await service.list(parsed.data.page, parsed.data.pageSize));
  });
  return router;
}
