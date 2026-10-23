import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { Prisma, type PrismaClient } from '@prisma/client';
import { createApp } from '../src/app';
import type { AuthConfig } from '../src/config/auth';
import { tokenAudience, tokenIssuer, type AuthUser } from '../src/services/auth';
import { AccountConflictError, createAccountRepository, type AccountRepository, type CreateAccountData } from '../src/repositories/accounts';

const config: AuthConfig = { secret: randomBytes(32).toString('hex'), expiresInSeconds: 3600, frontendOrigin: 'http://localhost:5173', production: false, loginLimit: 100, loginWindowMs: 60000, registrationLimit: 100 };
const password = 'Strong-Test-Password!123';
const patient = { name: 'Paciente Teste', email: 'patient@example.test', password, confirmPassword: password, phone: '(11) 99999-9999', birthDate: '2000-01-02' };
const dentist = { name: 'Dentista Teste', email: 'dentist@example.test', password, confirmPassword: password, role: 'DENTIST', croNumber: '12345', croState: 'sp', specialty: 'Ortodontia' };
function setup(settings: Partial<AuthConfig> = {}) {
  const stored: CreateAccountData[] = [];
  const admin: AuthUser = { id: 'admin-id', name: 'Admin', email: 'admin@example.test', role: 'ADMIN', status: 'ACTIVE', passwordHash: '' };
  let actor: AuthUser | null = admin;
  let failProfile = false;
  const repository: AccountRepository = {
    async create(data) {
      if (stored.some((row) => row.email === data.email || (row.dentistProfile && data.dentistProfile && row.dentistProfile.croNumber === data.dentistProfile.croNumber && row.dentistProfile.croState === data.dentistProfile.croState))) throw new AccountConflictError();
      if (failProfile) throw new Error('Simulated profile failure; private database detail');
      stored.push(data);
      return { id: `user-${stored.length}`, name: data.name, role: data.role };
    },
    async list(page, pageSize) {
      return { users: stored.slice((page - 1) * pageSize, page * pageSize).map((data, i) => ({ id: `user-${i}`, name: data.name, email: data.email, role: data.role, status: 'ACTIVE', createdAt: new Date() })), total: stored.length };
    },
  };
  const app = createApp({ ...config, ...settings }, { findByEmail: async () => actor, findById: async () => actor }, repository);
  const token = jwt.sign({}, config.secret, { subject: admin.id, issuer: tokenIssuer, audience: tokenAudience, expiresIn: 3600 });
  function post(path: string, body: unknown, authenticated = false) {
    const req = request(app).post(path).set('Origin', config.frontendOrigin).set('X-OdontoTech-CSRF', '1');
    if (authenticated) req.set('Cookie', `odontotech_session=${token}`);
    return req.send(body);
  }
  return { app, stored, repository, post, token, actor: (role: AuthUser['role']) => { actor = { ...admin, role }; }, inactive: () => { actor = { ...admin, status: 'INACTIVE' }; }, fail: () => { failProfile = true; } };
}

test('cadastro público cria PATIENT e perfil com Argon2id e dados públicos; não inicia sessão', async () => {
  const s = setup();
  const result = await s.post('/auth/register', { ...patient, email: '  PATIENT@EXAMPLE.TEST ' }).expect(201);
  assert.deepEqual(result.body, { user: { id: 'user-1', name: patient.name, role: 'PATIENT' } });
  assert.equal(result.headers['set-cookie'], undefined);
  const data = s.stored[0];
  assert.equal(data.email, patient.email); assert.equal(data.role, 'PATIENT');
  assert.equal(data.patientProfile?.phone, patient.phone);
  assert.equal(data.patientProfile?.birthDate?.toISOString(), '2000-01-02T00:00:00.000Z');
  assert.equal(data.dentistProfile, undefined);
  assert.match(data.passwordHash, /^\$argon2id\$/);
  assert.ok(await argon2.verify(data.passwordHash, password));
  assert.ok(!JSON.stringify(result.body).includes(password)); assert.ok(!JSON.stringify(result.body).includes(data.passwordHash));
});
test('telefone e data de nascimento são opcionais; perfil é sempre criado', async () => {
  const s = setup(); const { phone, birthDate, ...minimal } = patient;
  await s.post('/auth/register', minimal).expect(201);
  assert.deepEqual(s.stored[0].patientProfile, {});
});
test('cadastro rejeita campos obrigatórios ausentes, senha fraca, confirmação, data e telefone inválidos', async () => {
  const s = setup();
  const bad = [{}, { ...patient, name: ' ' }, { ...patient, email: 'invalid' }, { ...patient, password: 'short', confirmPassword: 'short' }, { ...patient, confirmPassword: 'different' }, { ...patient, birthDate: '2000-02-30' }, { ...patient, birthDate: '9999-01-01' }, { ...patient, phone: 'invalid' }];
  for (const body of bad) await s.post('/auth/register', body).expect(400);
  assert.equal(s.stored.length, 0);
});
test('cadastro público rejeita elevação de perfil/estado, hash e IDs internos', async () => {
  const s = setup();
  for (const extra of [{ role: 'ADMIN' }, { role: 'RECEPTIONIST' }, { role: 'DENTIST' }, { status: 'ACTIVE' }, { passwordHash: 'injected' }, { isAdmin: true }, { id: 'injected' }, { userId: 'injected' }]) {
    await s.post('/auth/register', { ...patient, ...extra }).expect(400);
  }
  assert.equal(s.stored.length, 0);
});
test('e-mail duplicado e colisão concorrente retornam 409 sem contas duplicadas', async () => {
  const s = setup();
  const results = await Promise.all([s.post('/auth/register', patient), s.post('/auth/register', { ...patient, email: patient.email.toUpperCase() })]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  assert.equal(s.stored.length, 1);
  const r = await s.post('/auth/register', patient).expect(409);
  assert.ok(!JSON.stringify(r.body).includes('P2002'));
});
test('falha na criação do perfil retorna erro controlado e não deixa conta parcial', async () => {
  const s = setup(); s.fail();
  const r = await s.post('/auth/register', patient).expect(500);
  assert.equal(s.stored.length, 0); assert.equal(r.body.message, 'Não foi possível concluir o pedido. Tente novamente.');
  assert.ok(!JSON.stringify(r.body).includes('private database detail'));
});
test('cadastro respeita CSRF e limite independente de tentativas', async () => {
  const s = setup({ registrationLimit: 2 });
  await request(s.app).post('/auth/register').send(patient).expect(403);
  await s.post('/auth/register', {}).expect(400); await s.post('/auth/register', {}).expect(400);
  const r = await s.post('/auth/register', {}).expect(429); assert.ok(r.headers['retry-after']);
  await s.post('/auth/login', {}).expect(400);
});
test('ADMIN cria rececionista sem perfis indevidos e dentista com CRO normalizado', async () => {
  const s = setup();
  const receptionist = { name: 'Recepção', email: 'reception@example.test', password, confirmPassword: password, role: 'RECEPTIONIST' };
  const r = await s.post('/admin/users', receptionist, true).expect(201);
  assert.equal(r.body.user.role, 'RECEPTIONIST'); assert.equal(r.body.user.passwordHash, undefined);
  assert.equal(s.stored[0].patientProfile, undefined); assert.equal(s.stored[0].dentistProfile, undefined);
  const d = await s.post('/admin/users', dentist, true).expect(201);
  assert.equal(d.body.user.role, 'DENTIST'); assert.equal(d.body.user.passwordHash, undefined);
  assert.deepEqual(s.stored[1].dentistProfile, { croNumber: '12345', croState: 'SP', specialty: 'Ortodontia' });
});
test('rotas administrativas exigem autenticação, conta ativa e perfil ADMIN atual', async () => {
  const s = setup();
  await s.post('/admin/users', dentist).expect(401);
  await request(s.app).get('/admin/users').expect(401);
  for (const role of ['PATIENT', 'RECEPTIONIST', 'DENTIST'] as const) {
    s.actor(role); await s.post('/admin/users', dentist, true).expect(403);
    await request(s.app).get('/admin/users').set('Cookie', `odontotech_session=${s.token}`).expect(403);
  }
  s.inactive(); await s.post('/admin/users', dentist, true).expect(401);
  assert.equal(s.stored.length, 0);
});
test('endpoint administrativo rejeita ADMIN, PATIENT, estado arbitrário e CRO ausente/inválido', async () => {
  const s = setup();
  for (const body of [{ ...dentist, role: 'ADMIN' }, { ...dentist, role: 'PATIENT' }, { ...dentist, status: 'INACTIVE' }, { ...dentist, croNumber: '' }, { ...dentist, croState: 'Sao Paulo' }, { ...dentist, croState: undefined }, { ...dentist, password: 'weak' }]) await s.post('/admin/users', body, true).expect(400);
  assert.equal(s.stored.length, 0);
});
test('duplicação de e-mail/CRO e falha de perfil profissional são controladas', async () => {
  const s = setup(); await s.post('/admin/users', dentist, true).expect(201);
  await s.post('/admin/users', dentist, true).expect(409);
  await s.post('/admin/users', { ...dentist, email: 'another@example.test' }, true).expect(409);
  s.fail(); await s.post('/admin/users', { ...dentist, croNumber: 'other', email: 'other@example.test' }, true).expect(500);
  assert.equal(s.stored.length, 1);
});
test('listagem administrativa é paginada, validada e contém apenas campos permitidos', async () => {
  const s = setup(); await s.post('/admin/users', dentist, true).expect(201);
  const r = await request(s.app).get('/admin/users?page=1&pageSize=1').set('Cookie', `odontotech_session=${s.token}`).expect(200);
  assert.equal(r.body.total, 1); assert.equal(r.body.users.length, 1);
  assert.deepEqual(Object.keys(r.body.users[0]).sort(), ['createdAt', 'email', 'id', 'name', 'role', 'status']);
  await request(s.app).get('/admin/users?pageSize=100000').set('Cookie', `odontotech_session=${s.token}`).expect(400);
});
test('repositório Prisma usa uma única escrita aninhada com estado ACTIVE, seleção pública e sem credenciais do cliente', async () => {
  let captured: Prisma.UserCreateArgs | undefined;
  const database = { user: { create: async (args: Prisma.UserCreateArgs) => { captured = args; return { id: 'id', name: args.data.name, role: args.data.role }; } } } as unknown as PrismaClient;
  const repo = createAccountRepository(database);
  await repo.create({ name: 'Teste', email: 'test@example.test', passwordHash: 'hash', role: 'PATIENT', patientProfile: { birthDate: new Date('2000-01-01') } });
  assert.equal(captured?.data.status, 'ACTIVE');
  assert.deepEqual(captured?.data.patientProfile, { create: { birthDate: new Date('2000-01-01') } });
  assert.deepEqual(captured?.select, { id: true, name: true, role: true });
  await repo.create({ name: 'Dentista', email: 'dentist@example.test', passwordHash: 'hash', role: 'DENTIST', dentistProfile: { croNumber: '123', croState: 'SP' } });
  assert.deepEqual(captured?.data.dentistProfile, { create: { croNumber: '123', croState: 'SP' } });
});
test('repositório trata P2002 da restrição UNIQUE e propaga outras falhas sem escrita compensatória', async () => {
  let error: Error = new Prisma.PrismaClientKnownRequestError('private SQL detail', { code: 'P2002', clientVersion: '6.12.0' });
  let calls = 0;
  const database = { user: { create: async () => { calls++; throw error; } } } as unknown as PrismaClient;
  const repo = createAccountRepository(database);
  const data: CreateAccountData = { name: 'Teste', email: 'test@example.test', passwordHash: 'hash', role: 'PATIENT', patientProfile: {} };
  await assert.rejects(repo.create(data), AccountConflictError);
  error = new Error('profile failed');
  await assert.rejects(repo.create(data), /profile failed/);
  assert.equal(calls, 2);
});
