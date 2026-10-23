import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { Prisma, type PrismaClient } from '@prisma/client';
import { createApp } from '../src/app';
import { readClinicConfig } from '../src/config/clinic';
import { createBudgetRepository, type BudgetRepository } from '../src/repositories/budgets';
import { installmentPlan } from '../src/services/budgets';
import { tokenAudience, tokenIssuer, type AuthUser } from '../src/services/auth';

const config = { secret: randomBytes(32).toString('hex'), expiresInSeconds: 3600, frontendOrigin: 'http://localhost:5173', production: false, loginLimit: 100, loginWindowMs: 60000 };
const input = { patientId: 'p1', items: [{ procedureId: 'proc1', quantity: 3 }, { procedureId: 'proc2', quantity: 1 }], installments: 3 };
function setup() {
  let actor: AuthUser = { id: 'dentist', name: 'Profissional', email: 'dentist@example.test', passwordHash: '', role: 'DENTIST', status: 'ACTIVE' };
  let hasProfile = true;
  const procedures = [{ id: 'proc1', name: 'Procedimento A', description: 'Descrição do catálogo A', defaultPrice: new Prisma.Decimal('0.10') }, { id: 'proc2', name: 'Procedimento B', description: null, defaultPrice: new Prisma.Decimal('99.71') }, { id: 'unpriced', name: 'Sem preço', description: null, defaultPrice: null }, { id: 'free', name: 'Gratuito explícito', description: null, defaultPrice: new Prisma.Decimal(0) }];
  const repository: BudgetRepository = {
    dentist: async (id) => hasProfile && id === 'dentist' ? { id: 'd1', name: actor.name, croNumber: '123', croState: 'SP' } : null,
    patient: async (userId, id) => userId === 'dentist' && id === 'p1' ? { id, name: 'Paciente autorizado' } : null,
    patients: async (id) => id === 'dentist' ? [{ id: 'p1', name: 'Paciente autorizado' }] : [],
    procedures: async () => procedures,
    selectedProcedures: async (ids) => procedures.filter((p) => ids.includes(p.id)),
  };
  const app = createApp(config, { findByEmail: async () => actor, findById: async () => actor }, undefined, undefined, readClinicConfig({}), undefined, repository);
  const cookie = () => `odontotech_session=${jwt.sign({}, config.secret, { subject: actor.id, issuer: tokenIssuer, audience: tokenAudience, expiresIn: 3600 })}`;
  const get = (path: string) => request(app).get(`/budget-simulations/${path}`).set('Cookie', cookie());
  const simulate = (body: unknown = input) => request(app).post('/budget-simulations/simulate').set('Cookie', cookie()).set('Origin', config.frontendOrigin).set('X-OdontoTech-CSRF', '1').send(body);
  return { app, get, simulate, procedures, actor: (role: AuthUser['role']) => { actor = { ...actor, role }; }, noProfile: () => { hasProfile = false; }, inactive: () => { actor.status = 'INACTIVE'; } };
}
test('simulação calcula preços do servidor, subtotais Decimal, total e identificação real', async () => {
  const s = setup(); const response = await s.simulate().expect(200);
  assert.equal(response.body.total, '100.01'); assert.equal(response.body.items[0].subtotal, '0.30'); assert.equal(response.body.items[1].unitPrice, '99.71');
  assert.equal(response.body.items[0].description, 'Descrição do catálogo A'); assert.equal(response.body.patient.name, 'Paciente autorizado'); assert.equal(response.body.dentist.croState, 'SP');
  assert.equal(response.body.persisted, false); assert.equal(response.body.currency, 'BRL'); assert.match(response.body.notice, /Não constitui pagamento/); assert.equal(response.headers['cache-control'], 'no-store');
  assert.ok(Number.isFinite(Date.parse(response.body.createdAt))); assert.equal(response.body.patient.user, undefined);
});
test('parcelamentos 1 a 12 somam exatamente o total, incluindo valores de poucos centavos', () => {
  for (const amount of ['0.00', '0.01', '0.05', '1.00', '100.01', '999999999.99']) for (let count = 1; count <= 12; count++) {
    const plan = installmentPlan(new Prisma.Decimal(amount), count);
    assert.equal(plan.amounts.length, count);
    assert.equal(plan.amounts.reduce((sum, value) => sum.plus(value), new Prisma.Decimal(0)).toFixed(2), amount);
    assert.ok(plan.amounts.every((value) => new Prisma.Decimal(value).gte(0)));
  }
  assert.deepEqual(installmentPlan(new Prisma.Decimal('100.01'), 3).amounts, ['33.33', '33.33', '33.35']);
  assert.equal(installmentPlan(new Prisma.Decimal('1.005'), 1).lastAmount, '1.01');
});
test('comparação inclui 1, 3, 6, 12 e opção personalizada; remoção altera total', async () => {
  const s = setup(); const response = await s.simulate({ ...input, installments: 2, items: [input.items[0]] }).expect(200);
  assert.equal(response.body.total, '0.30'); assert.deepEqual(response.body.plans.map((p: any) => p.count), [1, 2, 3, 6, 12]);
});
test('preços e totais arbitrários, IDs internos e taxas são recusados', async () => {
  const s = setup();
  for (const extra of [{ total: '0.01' }, { dentistId: 'other' }, { authorId: 'other' }, { interestRate: 20 }, { status: 'APPROVED' }]) await s.simulate({ ...input, ...extra }).expect(400);
  await s.simulate({ ...input, items: [{ procedureId: 'proc1', quantity: 1, unitPrice: '0.01' }] }).expect(400);
});
test('quantidades, referências e limites são validados', async () => {
  const s = setup();
  for (const quantity of [0, -1, 101, 1.5, '2']) await s.simulate({ ...input, items: [{ procedureId: 'proc1', quantity }] }).expect(400);
  for (const installments of [0, -1, 13, 1.5, '3']) await s.simulate({ ...input, installments }).expect(400);
  await s.simulate({ ...input, items: [] }).expect(400);
  await s.simulate({ ...input, items: [input.items[0], input.items[0]] }).expect(400);
  await s.simulate({ ...input, items: Array.from({ length: 51 }, (_, i) => ({ procedureId: `p${i}`, quantity: 1 })) }).expect(400);
  await s.simulate({ ...input, patientId: 'other' }).expect(404);
  await s.simulate({ ...input, patientId: 'missing' }).expect(404);
  await s.simulate({ ...input, items: [{ procedureId: 'missing', quantity: 1 }] }).expect(400);
});
test('procedimento sem preço não vira zero; zero explícito é válido', async () => {
  const s = setup(); await s.simulate({ ...input, items: [{ procedureId: 'unpriced', quantity: 1 }] }).expect(409);
  const result = await s.simulate({ ...input, items: [{ procedureId: 'free', quantity: 1 }] }).expect(200); assert.equal(result.body.total, '0.00');
  const catalog = await s.get('procedures').expect(200); assert.equal(catalog.body.items.find((p: any) => p.id === 'unpriced').unitPrice, null);
});
test('autenticação, perfis, DentistProfile válido e CSRF são obrigatórios', async () => {
  const s = setup(); await request(s.app).get('/budget-simulations/procedures').expect(401);
  await request(s.app).post('/budget-simulations/simulate').send(input).expect(403);
  for (const role of ['ADMIN', 'RECEPTIONIST', 'PATIENT'] as const) { s.actor(role); await s.get('patients').expect(403); await s.get('procedures').expect(403); await s.simulate().expect(403); }
  s.actor('DENTIST'); s.noProfile(); await s.simulate().expect(403); await s.get('patients').expect(403);
  s.inactive(); await s.get('procedures').expect(401);
});
test('opções são paginadas e rejeitam filtros que tentam ampliar o acesso', async () => {
  const s = setup(); const result = await s.get('procedures?pageSize=1').expect(200); assert.equal(result.body.items.length, 1); assert.equal(result.body.hasMore, true);
  await s.get('patients?dentistId=other').expect(400); await s.get('procedures?pageSize=51').expect(400);
});
test('novos cálculos usam o preço atual devolvido pelo repositório, sem alterar resumo anterior', async () => {
  const s = setup(); const original = await s.simulate().expect(200);
  s.procedures[0].defaultPrice = new Prisma.Decimal('10.00');
  const next = await s.simulate().expect(200); assert.equal(next.body.total, '129.71'); assert.equal(original.body.total, '100.01');
});
test('repositório impõe vínculo no SQL, perfis ativos e catálogo ativo sem selecionar dados clínicos', async () => {
  let patientQuery: any; let procedureQuery: any;
  const db = { patientProfile: { findFirst: async (args: any) => { patientQuery = args; return null; }, findMany: async (args: any) => { patientQuery = args; return []; } }, procedure: { findMany: async (args: any) => { procedureQuery = args; return []; } } } as unknown as PrismaClient;
  const repo = createBudgetRepository(db); await repo.patient('dentist-real', 'patient-id');
  assert.equal(patientQuery.where.appointments.some.dentist.userId, 'dentist-real'); assert.equal(patientQuery.where.appointments.some.status.not, 'CANCELLED'); assert.equal(patientQuery.where.user.role, 'PATIENT');
  assert.deepEqual(patientQuery.select, { id: true, user: { select: { name: true } } });
  await repo.patients('dentist-real', { search: 'Ana', page: 2, pageSize: 10 }); assert.equal(patientQuery.skip, 10); assert.equal(patientQuery.take, 11); assert.equal(patientQuery.where.user.name.contains, 'Ana');
  await repo.selectedProcedures(['p1']); assert.equal(procedureQuery.where.isActive, true); assert.deepEqual(procedureQuery.where.id.in, ['p1']);
});
