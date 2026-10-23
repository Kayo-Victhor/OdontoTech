import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import { z } from "zod";
import type { AuthConfig } from "./config/auth";
import {
  authenticate,
  cookieName,
  cookieOptions,
  protectCsrf,
} from "./middlewares/auth";
import { attemptLimiter } from "./middlewares/rate-limit";
import type { AccountRepository } from "./repositories/accounts";
import { createAccountRoutes } from "./routes/accounts";
import { createAuthService, type UserRepository } from "./services/auth";
import { HttpError } from "./utils/http-error";
import { emailSchema } from "./validators/accounts";
import type { AppointmentRepository } from './repositories/appointments';
import { readClinicConfig, type ClinicConfig } from './config/clinic';
import { createAppointmentRoutes } from './routes/appointments';
import type { ClinicalRepository } from './repositories/clinical';
import { createClinicalRoutes } from './routes/clinical';
import type { BudgetRepository } from './repositories/budgets';
import { createBudgetRoutes } from './routes/budgets';
import type { ProcedureRepository } from './repositories/procedures';
import { createProcedureRoutes } from './routes/procedures';

export function createApp(
  config: AuthConfig,
  users: UserRepository,
  accounts?: AccountRepository,
  appointments?: AppointmentRepository,
  clinic: ClinicConfig = readClinicConfig(),
  clinical?: ClinicalRepository,
  budgets?: BudgetRepository,
  procedures?: ProcedureRepository,
) {
  const app = express();
  app.disable("x-powered-by");
  // Sem trust proxy: não confiar em X-Forwarded-For arbitrário.
  app.use(
    cors({
      origin: config.frontendOrigin,
      credentials: true,
      allowedHeaders: ["Content-Type", "X-OdontoTech-CSRF"],
    }),
  );
  app.use(protectCsrf(config));
  app.use('/clinical', express.json({ limit: '32kb' }));
  app.use(express.json({ limit: "8kb" }));
  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });
  const auth = express.Router();
  auth.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  const service = createAuthService(config, users);
  const loginLimiter = attemptLimiter(config.loginLimit, config.loginWindowMs);
  const inputSchema = z.object({
    email: emailSchema,
    password: z.string().min(1).max(1024),
  });
  auth.post("/login", loginLimiter, async (req, res) => {
    const parsed = inputSchema.safeParse(req.body);
    if (!parsed.success)
      throw new HttpError(400, "Informe um e-mail válido e a senha.");
    const result = await service.login(parsed.data.email, parsed.data.password);
    res.cookie(cookieName(config), result.token, {
      ...cookieOptions(config),
      maxAge: config.expiresInSeconds * 1000,
    });
    res.json({ user: result.user });
  });
  auth.get("/me", authenticate(service, config), (_req, res) => {
    res.json({ user: res.locals.user });
  });
  auth.post("/logout", (_req, res) => {
    res.clearCookie(cookieName(config), cookieOptions(config));
    res.status(204).end();
  });
  app.use("/auth", auth);
  app.use(createAccountRoutes(config, service, accounts));
  if (appointments) app.use('/appointments', createAppointmentRoutes(config, service, appointments, clinic));
  if (clinical) app.use('/clinical', createClinicalRoutes(config, service, clinical, clinic));
  if (budgets) app.use('/budget-simulations', createBudgetRoutes(config, service, budgets, clinic));
  if (procedures) app.use(createProcedureRoutes(config, service, procedures));
  app.use((_req, res) => {
    res.status(404).json({ message: "Rota não encontrada" });
  });
  const handleError: ErrorRequestHandler = (
    error: unknown,
    _req,
    res,
    _next,
  ) => {
    if (error instanceof HttpError) {
      res.status(error.status).json({ message: error.message });
      return;
    }
    const status =
      typeof error === "object" && error !== null && "status" in error
        ? error.status
        : undefined;
    if (status === 400 || status === 413) {
      res
        .status(status)
        .json({
          message: status === 413 ? "Pedido muito grande." : "Pedido inválido.",
        });
      return;
    }
    console.error("Erro interno ao processar a requisição.");
    res
      .status(500)
      .json({
        message: "Não foi possível concluir o pedido. Tente novamente.",
      });
  };
  app.use(handleError);
  return app;
}
