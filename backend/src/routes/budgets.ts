import { Router } from 'express';
import type { AuthConfig } from '../config/auth';
import type { ClinicConfig } from '../config/clinic';
import { authenticate, authorize } from '../middlewares/auth';
import type { BudgetRepository } from '../repositories/budgets';
import type { AuthService, PublicUser } from '../services/auth';
import { createBudgetService } from '../services/budgets';
import { budgetSearchSchema, budgetSimulationSchema } from '../validators/budgets';
import { HttpError } from '../utils/http-error';

export function createBudgetRoutes(authConfig: AuthConfig, auth: AuthService, repository: BudgetRepository, clinic: ClinicConfig) {
  const router = Router();
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.use(authenticate(auth, authConfig), authorize('DENTIST'));
  const service = createBudgetService(repository, clinic);
  const actor = (res: { locals: Record<string, unknown> }) => res.locals.user as PublicUser;
  for (const resource of ['patients', 'procedures'] as const) router.get(`/${resource}`, async (req, res) => {
    const query = budgetSearchSchema.safeParse(req.query);
    if (!query.success) throw new HttpError(400, 'Pesquisa inválida.');
    res.json(await service[resource](actor(res), query.data));
  });
  router.post('/simulate', async (req, res) => {
    const input = budgetSimulationSchema.safeParse(req.body);
    if (!input.success) throw new HttpError(400, 'Selecione paciente, 1 a 50 procedimentos únicos, quantidades de 1 a 100 e 1 a 12 parcelas. Não envie preços ou totais.');
    res.json(await service.simulate(actor(res), input.data));
  });
  return router;
}
