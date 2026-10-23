import { Router } from 'express';
import type { AuthConfig } from '../config/auth';
import { authenticate, authorize } from '../middlewares/auth';
import type { ProcedureRepository } from '../repositories/procedures';
import type { AuthService, PublicUser } from '../services/auth';
import { createProcedureService } from '../services/procedures';
import { createProcedureSchema, editProcedureSchema, procedureSearchSchema } from '../validators/procedures';
import { HttpError } from '../utils/http-error';

export function createProcedureRoutes(config: AuthConfig, auth: AuthService, repository: ProcedureRepository) {
  const router = Router();
  router.use(['/procedures', '/admin/procedures'], (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); }, authenticate(auth, config));
  const service = createProcedureService(repository);
  const actor = (res: { locals: Record<string, unknown> }) => res.locals.user as PublicUser;
  for (const administrative of [false, true]) router.get(administrative ? '/admin/procedures' : '/procedures', authorize(...(administrative ? ['ADMIN' as const] : ['ADMIN' as const, 'DENTIST' as const])), async (req, res) => {
    const query = procedureSearchSchema.safeParse(req.query); if (!query.success) throw new HttpError(400, 'Filtros do catálogo inválidos.');
    res.json(await service.list(query.data, actor(res), administrative));
  });
  router.post('/admin/procedures', authorize('ADMIN'), async (req, res) => {
    const input = createProcedureSchema.safeParse(req.body); if (!input.success) throw new HttpError(400, 'Verifique nome, preço decimal (até 2 casas) e duração inteira de 1 a 1440 minutos.');
    res.status(201).json({ procedure: await service.create(input.data, actor(res)) });
  });
  router.patch('/admin/procedures/:id', authorize('ADMIN'), async (req, res) => {
    const input = editProcedureSchema.safeParse(req.body); if (!input.success) throw new HttpError(400, 'Campos de procedimento inválidos. Não envie IDs ou datas internas.');
    res.json({ procedure: await service.update(String(req.params.id), input.data, actor(res)) });
  });
  return router;
}
