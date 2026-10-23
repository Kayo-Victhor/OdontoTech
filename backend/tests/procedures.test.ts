import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { Prisma, type PrismaClient } from '@prisma/client';
import { createApp } from '../src/app';
import { readClinicConfig } from '../src/config/clinic';
import { createProcedureRepository, type ProcedureRepository, type ProcedureRow } from '../src/repositories/procedures';
import { procedurePriceSchema } from '../src/validators/procedures';
import { tokenAudience, tokenIssuer, type AuthUser } from '../src/services/auth';
import { HttpError } from '../src/utils/http-error';

const config = { secret: randomBytes(32).toString('hex'), expiresInSeconds: 3600, frontendOrigin: 'http://localhost:5173', production: false, loginLimit: 100, loginWindowMs: 60000 };
function fixture(overrides: Partial<ProcedureRow> = {}): ProcedureRow { return { id: 'proc1', name: 'Procedimento original', description: 'Descrição original', defaultPrice: null, estimatedDurationMinutes: 30, isActive: true, createdAt: new Date(), updatedAt: new Date(), ...overrides }; }
function setup() {
  let actor: AuthUser = { id: 'admin', name: 'Admin', email: 'admin@example.test', role: 'ADMIN', status: 'ACTIVE', passwordHash: '' }; let dentistProfile = true;
  const rows = [fixture(), fixture({ id: 'proc2', name: 'Desativado', defaultPrice: new Prisma.Decimal('0'), isActive: false })];
  const repository: ProcedureRepository = {
    list: async (query, activeOnly) => rows.filter((row) => (!activeOnly || row.isActive) && row.name.includes(query.search)).slice((query.page - 1) * query.pageSize, query.page * query.pageSize + 1),
    hasDentistProfile: async () => dentistProfile,
    create: async (input) => { const row = fixture({ id: `proc${rows.length + 1}`, ...input, description: input.description ?? null, defaultPrice: input.defaultPrice == null ? null : new Prisma.Decimal(input.defaultPrice), estimatedDurationMinutes: input.estimatedDurationMinutes ?? null }); rows.push(row); return row; },
    update: async (id, input) => { const row = rows.find((r) => r.id === id); if (!row) throw new HttpError(404, 'Procedimento não encontrado.'); Object.assign(row, { ...input, ...(input.defaultPrice === undefined ? {} : { defaultPrice: input.defaultPrice === null ? null : new Prisma.Decimal(input.defaultPrice) }), updatedAt: new Date() }); return row; },
  };
  const app = createApp(config, { findById: async () => actor, findByEmail: async () => actor }, undefined, undefined, readClinicConfig({}), undefined, undefined, repository);
  const cookie = () => `odontotech_session=${jwt.sign({}, config.secret, { subject: actor.id, issuer: tokenIssuer, audience: tokenAudience, expiresIn: 3600 })}`;
  const get = (path: string) => request(app).get(path).set('Cookie', cookie());
  const write = (method: 'post' | 'patch', body: unknown, id?: string) => request(app)[method](`/admin/procedures${id ? `/${id}` : ''}`).set('Cookie', cookie()).set('Origin', config.frontendOrigin).set('X-OdontoTech-CSRF', '1').send(body);
  return { app, rows, get, write, actor: (role: AuthUser['role']) => { actor = { ...actor, role }; }, noProfile: () => { dentistProfile = false; }, inactive: () => { actor.status = 'INACTIVE'; } };
}
test('ADMIN lista desativados e sem preço; catálogo ativo exclui desativados e distingue zero', async () => {
  const s = setup(); const admin = await s.get('/admin/procedures').expect(200); assert.equal(admin.body.items.length, 2); assert.equal(admin.body.items[0].defaultPrice, null); assert.equal(admin.body.items[1].defaultPrice, '0.00'); assert.equal(admin.headers['cache-control'], 'no-store');
  s.actor('DENTIST'); const active = await s.get('/procedures').expect(200); assert.equal(active.body.items.length, 1); assert.equal(active.body.items[0].id, 'proc1');
});
test('ADMIN cria normalizando nome, com preço Decimal e duração opcional', async () => {
  const s = setup(); const result = await s.write('post', { name: '  Limpeza   profissional  ', defaultPrice: '100.10', description: '', isActive: true }).expect(201);
  assert.equal(result.body.procedure.name, 'Limpeza profissional'); assert.equal(result.body.procedure.defaultPrice, '100.10'); assert.equal(result.body.procedure.description, null); assert.equal(result.body.procedure.estimatedDurationMinutes, null);
  const unpriced = await s.write('post', { name: 'Sem preço' }).expect(201); assert.equal(unpriced.body.procedure.defaultPrice, null);
});
test('ADMIN edita preço, descrição, duração e disponibilidade sem mudar ID, criação ou histórico', async () => {
  const s = setup(); const before = structuredClone(s.rows[0]);
  const result = await s.write('patch', { name: 'Revisado', defaultPrice: '0', estimatedDurationMinutes: null, isActive: false }, 'proc1').expect(200);
  assert.equal(result.body.procedure.id, before.id); assert.equal(result.body.procedure.createdAt, before.createdAt.toISOString()); assert.equal(result.body.procedure.defaultPrice, '0.00'); assert.equal(s.rows[0].description, before.description);
  await s.write('patch', { defaultPrice: null }, 'proc1').expect(200); assert.equal(s.rows[0].defaultPrice, null);
});
test('preços inválidos ou com precisão excessiva são recusados sem arredondamento silencioso', async () => {
  const s = setup();
  for (const defaultPrice of ['-1', '1.005', '1,50', '1e3', 'NaN', '100000000', '01.00', '', 2, true]) { assert.equal(procedurePriceSchema.safeParse(defaultPrice).success, false); await s.write('post', { name: 'Teste', defaultPrice }).expect(400); }
  assert.equal(procedurePriceSchema.safeParse('99999999.99').success, true);
});
test('valida duração, nome, campos proibidos e edição vazia', async () => {
  const s = setup();
  for (const estimatedDurationMinutes of [0, -1, 1441, 1.5, '30']) await s.write('post', { name: 'Teste', estimatedDurationMinutes }).expect(400);
  for (const name of ['', ' ', 'x', 'x'.repeat(192)]) await s.write('post', { name }).expect(400);
  for (const extra of [{ id: 'fake' }, { createdAt: '2000-01-01' }, { updatedAt: '2000-01-01' }, { authorId: 'fake' }, { price: 1 }, { clinicalProcedures: [] }]) await s.write('post', { name: 'Teste', ...extra }).expect(400);
  await s.write('patch', {}, 'proc1').expect(400); await s.write('patch', { defaultPrice: '10.00' }, 'missing').expect(404);
});
test('DENTIST, RECEPTIONIST e PATIENT não podem gerir catálogo; sem sessão e CSRF são recusados', async () => {
  const s = setup(); await request(s.app).get('/admin/procedures').expect(401); await request(s.app).get('/procedures').expect(401);
  await request(s.app).post('/admin/procedures').send({ name: 'Teste' }).expect(403);
  for (const role of ['DENTIST', 'RECEPTIONIST', 'PATIENT'] as const) { s.actor(role); await s.get('/admin/procedures').expect(403); await s.write('post', { name: 'Teste' }).expect(403); await s.write('patch', { defaultPrice: '0' }, 'proc1').expect(403); if (role !== 'DENTIST') await s.get('/procedures').expect(403); }
  s.actor('DENTIST'); s.noProfile(); await s.get('/procedures').expect(403); s.inactive(); await s.get('/procedures').expect(401);
});
test('paginação é limitada e filtros não concedem acesso a desativados', async () => {
  const s = setup(); const response = await s.get('/admin/procedures?pageSize=1').expect(200); assert.equal(response.body.items.length, 1); assert.equal(response.body.hasMore, true);
  await s.get('/procedures?isActive=false').expect(400); await s.get('/admin/procedures?pageSize=51').expect(400);
});
test('repositório usa Decimal em escritas e filtra ativos com ordenação estável', async () => {
  let query: any; let data: any;
  const repository = createProcedureRepository({ procedure: { create: async (args: any) => { data = args.data; return fixture(); }, update: async (args: any) => { data = args.data; return fixture(); }, findMany: async (args: any) => { query = args; return []; } } } as unknown as PrismaClient);
  await repository.create({ name: 'Teste', defaultPrice: '125.50' }); assert.ok(data.defaultPrice instanceof Prisma.Decimal); assert.equal(data.defaultPrice.toFixed(2), '125.50'); assert.equal(data.estimatedDurationMinutes, null);
  await repository.update('proc1', { defaultPrice: null }); assert.equal(data.defaultPrice, null);
  await repository.list({ search: '', page: 2, pageSize: 10 }, true); assert.equal(query.where.isActive, true); assert.equal(query.skip, 10); assert.equal(query.take, 11); assert.deepEqual(query.orderBy, [{ name: 'asc' }, { id: 'asc' }]);
  await repository.list({ search: '', page: 1, pageSize: 10 }, false); assert.equal(query.where.isActive, undefined);
});
test('erros de unicidade e identificador inexistente são controlados e não expõem Prisma/SQL', async () => {
  for (const [code, status] of [['P2002', 409], ['P2025', 404], ['P2003', 400], ['P2000', 400]]) {
    const repository = createProcedureRepository({ procedure: { update: async () => { throw new Prisma.PrismaClientKnownRequestError('private SQL', { code, clientVersion: '6.12.0' }); } } } as unknown as PrismaClient);
    await assert.rejects(repository.update('missing', { isActive: false }), (e: any) => e.status === status && !e.message.includes('SQL'));
  }
});
