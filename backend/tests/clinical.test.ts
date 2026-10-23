import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { Prisma, type PrismaClient } from '@prisma/client';
import { createApp } from '../src/app';
import { readClinicConfig } from '../src/config/clinic';
import type { AuthConfig } from '../src/config/auth';
import { tokenAudience, tokenIssuer, type AuthUser } from '../src/services/auth';
import { createClinicalRepository, type ClinicalAppointment, type ClinicalRepository, type ClinicalRow, type ClinicalTransaction } from '../src/repositories/clinical';

const config: AuthConfig = { secret: randomBytes(32).toString('hex'), production: false, frontendOrigin: 'http://localhost:5173', expiresInSeconds: 3600, loginLimit: 100, loginWindowMs: 60000 };
const context = (): ClinicalAppointment => ({ id: 'a1', patientId: 'p1', dentistId: 'd1', startAt: new Date('2026-11-01T11:00:00Z'), endAt: new Date('2026-11-01T12:00:00Z'), status: 'IN_PROGRESS',
  patient: { id: 'p1', phone: '11999999999', birthDate: new Date('2000-01-01'), user: { id: 'patient', name: 'Paciente', role: 'PATIENT', status: 'ACTIVE' } },
  dentist: { id: 'd1', user: { id: 'dentist', name: 'Dentista', role: 'DENTIST', status: 'ACTIVE' } } });
function setup() {
  let actor: AuthUser = { id: 'dentist', name: 'Dentista', role: 'DENTIST', status: 'ACTIVE', email: 'fixture@example.test', passwordHash: '' };
  const appointment = context(); let record: ClinicalRow | null = null; let fail = false; const locks: string[] = [];
  const catalog = { name: 'Restauração original', description: 'Descrição original' };
  const tx: ClinicalTransaction = {
    appointment: async (id) => id === 'a1' ? appointment : null,
    record: async () => record,
    start: async (appointmentId, authorId) => record = { id: 'r1', appointmentId, authorId, author: { name: actor.name }, notes: '', finalizedAt: null, createdAt: new Date(), updatedAt: new Date(), procedures: [], addenda: [] },
    save: async (_id, data) => { if (fail) throw new Error('clinical secret not logged'); Object.assign(record!, data); return record!; },
    catalogItem: async (id) => id === 'catalog-1' ? catalog : null,
    addProcedure: async (_id, data) => { record!.procedures.push({ id: `cp${record!.procedures.length}`, ...data, createdAt: new Date() }); },
    addendum: async (_id, _authorId, content) => { record!.addenda.push({ id: 'ad1', content, createdAt: new Date(), author: { name: actor.name } }); },
  };
  const repository: ClinicalRepository = {
    appointment: tx.appointment, record: tx.record, catalog: async () => [{ id: 'catalog-1', name: catalog.name }],
    history: async (scope) => record && ('patientUserId' in scope ? scope.patientUserId === appointment.patient.user.id && !!record.finalizedAt : scope.dentistUserId === appointment.dentist.user.id) ? [{ ...record, appointment }] : [],
    transaction: async (dentist, id, work) => { locks.push(dentist, id); const original = structuredClone(record); try { return await work(tx); } catch (e) { record = original; throw e; } },
  };
  const users = { findById: async () => actor, findByEmail: async () => actor };
  const app = createApp(config, users, undefined, undefined, readClinicConfig({}), repository);
  const cookie = () => `odontotech_session=${jwt.sign({}, config.secret, { subject: actor.id, issuer: tokenIssuer, audience: tokenAudience, expiresIn: 3600 })}`;
  const get = (path = '/clinical/appointments/a1') => request(app).get(path).set('Cookie', cookie());
  const write = (method: 'post' | 'patch', suffix: string, body: unknown) => request(app)[method](`/clinical/appointments/a1${suffix}`).set('Cookie', cookie()).set('Origin', config.frontendOrigin).set('X-OdontoTech-CSRF', '1').send(body);
  const start = async () => (await write('post', '', {}).expect(200)).body.record;
  const version = () => record!.updatedAt.toISOString();
  const procedure = () => write('post', '/procedures', { expectedUpdatedAt: version(), procedureId: 'catalog-1', toothOrRegion: '16' });
  const ready = async () => { await start(); await write('patch', '', { notes: 'Notas clínicas de teste', expectedUpdatedAt: version() }).expect(200); await procedure().expect(201); };
  return { app, get, write, start, ready, version, procedure, catalog, appointment, repository, locks, row: () => record!, fail: () => { fail = true; }, actor: (role: AuthUser['role'], id = role.toLowerCase()) => { actor = { ...actor, role, id }; }, deactivate: () => { actor.status = 'INACTIVE'; } };
}
test('consulta clínica exige autenticação, conta ativa e dentista responsável; admin e recepção sem privilégios clínicos', async () => {
  const s = setup(); await request(s.app).get('/clinical/appointments/a1').expect(401);
  await s.get().expect(200);
  for (const role of ['ADMIN', 'RECEPTIONIST', 'PATIENT'] as const) { s.actor(role); await s.get().expect(403); await s.write('post', '', {}).expect(403); }
  s.actor('DENTIST', 'other'); await s.get().expect(404);
  s.actor('DENTIST'); s.deactivate(); await s.get().expect(401);
});
test('GET não cria registo e iniciar repetidamente devolve o mesmo ID com autor real', async () => {
  const s = setup(); assert.equal((await s.get()).body.record, null);
  const first = await s.start(); const second = await s.start(); assert.equal(first.id, second.id); assert.equal(first.authorId, undefined); assert.equal(s.row().authorId, 'dentist');
  assert.deepEqual(s.locks, ['d1', 'a1', 'd1', 'a1']);
  const data = (await s.get()).body; assert.equal(data.appointment.patient.birthDate, '2000-01-01'); assert.equal(data.appointment.patient.phone, '11999999999'); assert.equal(data.appointment.patient.user, undefined);
});
test('estados elegíveis, consulta inexistente, perfis inválidos e CSRF são verificados', async () => {
  for (const status of ['CANCELLED', 'NO_SHOW', 'SCHEDULED', 'WAITING', 'CONFIRMED'] as const) { const s = setup(); s.appointment.status = status; await s.write('post', '', {}).expect(409); }
  const s = setup(); await s.get('/clinical/appointments/missing').expect(404);
  s.appointment.dentist.user.role = 'ADMIN'; await s.get().expect(404);
  s.appointment.dentist.user.role = 'DENTIST'; s.appointment.patient.user.role = 'ADMIN'; await s.write('post', '', {}).expect(409);
  await request(s.app).post('/clinical/appointments/a1').send({}).expect(403);
});
test('rascunho guarda notas, rejeita versões obsoletas e campos internos ou desconhecidos', async () => {
  const s = setup(); const first = await s.start();
  await s.write('patch', '', { notes: 'Novo conteúdo', expectedUpdatedAt: first.updatedAt }).expect(200);
  assert.equal(s.row().notes, 'Novo conteúdo');
  await s.write('patch', '', { notes: 'Sobrescrita', expectedUpdatedAt: first.updatedAt }).expect(409);
  for (const extra of [{ authorId: 'fake' }, { appointmentId: 'other' }, { patientId: 'other' }, { finalizedAt: new Date().toISOString() }, { unknown: true }]) await s.write('patch', '', { notes: 'x', expectedUpdatedAt: s.version(), ...extra }).expect(400);
  await s.write('patch', '', { notes: 'x'.repeat(4001), expectedUpdatedAt: s.version() }).expect(400);
  await s.write('post', '', { authorId: 'fake' }).expect(400);
});
test('procedimentos validam catálogo e região e guardam snapshots independentes do catálogo', async () => {
  const s = setup(); await s.start();
  await s.write('post', '/procedures', { expectedUpdatedAt: s.version(), procedureId: 'missing', toothOrRegion: '16' }).expect(400);
  await s.write('post', '/procedures', { expectedUpdatedAt: s.version(), procedureName: 'Manual', toothOrRegion: '' }).expect(400);
  await s.write('post', '/procedures', { expectedUpdatedAt: s.version(), procedureName: 'Manual', toothOrRegion: 'Arcada superior', clinicalRecordId: 'other' }).expect(400);
  await s.procedure().expect(201); s.catalog.name = 'Nome alterado';
  assert.equal(s.row().procedures[0].procedureNameSnapshot, 'Restauração original'); assert.equal(s.row().procedures[0].descriptionSnapshot, 'Descrição original');
  await s.write('post', '/procedures', { expectedUpdatedAt: s.version(), procedureName: 'Manual', toothOrRegion: 'Arcada superior' }).expect(201);
  assert.equal(s.row().procedures.length, 2);
});
test('finalização exige notas e procedimentos, grava timestamp e não conclui consulta automaticamente', async () => {
  const s = setup(); await s.start(); await s.write('post', '/finalize', { expectedUpdatedAt: s.version() }).expect(400);
  await s.write('patch', '', { notes: 'Notas', expectedUpdatedAt: s.version() }).expect(200);
  await s.write('post', '/finalize', { expectedUpdatedAt: s.version() }).expect(400);
  await s.procedure().expect(201); const before = Date.now(); await s.write('post', '/finalize', { expectedUpdatedAt: s.version() }).expect(200);
  assert.ok(s.row().finalizedAt!.getTime() >= before); assert.equal(s.appointment.status, 'IN_PROGRESS'); assert.equal(s.row().authorId, 'dentist');
});
test('registo finalizado e procedimentos não aceitam alteração direta, repetição, edição ou eliminação', async () => {
  const s = setup(); await s.ready(); await s.write('post', '/finalize', { expectedUpdatedAt: s.version() }).expect(200);
  const original = structuredClone(s.row());
  await s.write('patch', '', { notes: 'Alterado', expectedUpdatedAt: s.version() }).expect(409);
  await s.procedure().expect(409); await s.write('post', '/finalize', { expectedUpdatedAt: s.version() }).expect(409);
  await s.write('patch', '/procedures/cp0', {}).expect(404);
  assert.deepEqual(s.row(), original);
});
test('aditamentos apenas após finalização preservam autoria, texto, procedimentos e finalização originais', async () => {
  const s = setup(); await s.ready(); await s.write('post', '/addenda', { content: 'Complemento' }).expect(409);
  await s.write('post', '/finalize', { expectedUpdatedAt: s.version() }).expect(200); const original = structuredClone(s.row());
  await s.write('post', '/addenda', { content: 'Complemento', authorId: 'fake' }).expect(400);
  await s.write('post', '/addenda', { content: 'Complemento' }).expect(201);
  const { addenda, ...data } = s.row(); const { addenda: _old, ...old } = original; assert.deepEqual(data, old); assert.equal(addenda[0].content, 'Complemento'); assert.equal(addenda[0].author.name, 'Dentista');
});
test('paciente recebe só histórico próprio finalizado; dentista não amplia âmbito e query IDs são rejeitados', async () => {
  const s = setup(); await s.ready(); s.actor('PATIENT');
  assert.deepEqual((await s.get('/clinical/history').expect(200)).body.items, []);
  await s.get('/clinical/history?patientId=p2').expect(400); await s.write('post', '/addenda', { content: 'x' }).expect(403);
  s.actor('DENTIST'); await s.write('post', '/finalize', { expectedUpdatedAt: s.version() }).expect(200);
  s.actor('PATIENT'); const own = await s.get('/clinical/history').expect(200); assert.equal(own.body.items.length, 1); assert.equal(own.body.items[0].authorId, undefined); assert.equal(own.headers['cache-control'], 'no-store');
  s.actor('PATIENT', 'other'); assert.deepEqual((await s.get('/clinical/history')).body.items, []);
  s.actor('DENTIST', 'other'); await s.get('/clinical/appointments/a1/history').expect(404);
});
test('cancelamento não remove conteúdo e impede novas escritas de rascunho', async () => {
  const s = setup(); await s.ready(); s.appointment.status = 'CANCELLED'; const notes = s.row().notes;
  await s.get().expect(200); await s.write('patch', '', { notes: 'x', expectedUpdatedAt: s.version() }).expect(409); assert.equal(s.row().notes, notes);
});
test('falha durante procedimento reverte a operação e erro HTTP não inclui dados clínicos', async () => {
  const s = setup(); await s.start(); s.fail();
  const response = await s.procedure().expect(500); assert.equal(s.row().procedures.length, 0); assert.ok(!JSON.stringify(response.body).includes('clinical secret'));
});
test('repositório aplica escopo SQL, paginação limitada e ordem estável do histórico', async () => {
  let query: any;
  const repository = createClinicalRepository({ clinicalRecord: { findMany: async (args: unknown) => { query = args; return []; } } } as unknown as PrismaClient);
  await repository.history({ patientUserId: 'patient' }, { page: 2, pageSize: 10 });
  assert.equal(query.where.finalizedAt.not, null); assert.equal(query.where.appointment.patient.userId, 'patient'); assert.equal(query.take, 11); assert.equal(query.skip, 10); assert.deepEqual(query.orderBy, [{ appointment: { startAt: 'desc' } }, { id: 'desc' }]);
  await repository.history({ patientId: 'p1', dentistUserId: 'dentist' }, { page: 1, pageSize: 10 }); assert.equal(query.where.appointment.dentist.userId, 'dentist');
});
test('repositório bloqueia na ordem da agenda e converte erros de integridade sem SQL ou conteúdo', async () => {
  const names: string[] = []; let isolation: unknown;
  const db = { $transaction: async (work: (tx: unknown) => Promise<unknown>, options: unknown) => { isolation = options; return work({ $queryRaw: async (strings: TemplateStringsArray) => { names.push(strings.join('?')); } }); } } as unknown as PrismaClient;
  await createClinicalRepository(db).transaction('d1', 'a1', async () => true);
  assert.ok(names[0].includes('DentistProfile')); assert.ok(names[1].includes('Appointment')); assert.ok(names[2].includes('ClinicalRecord')); assert.equal((isolation as any).isolationLevel, 'ReadCommitted');
  for (const [code, status] of [['P2034', 409], ['P2028', 409], ['P2002', 409], ['P2003', 400], ['P2025', 404]]) {
    const repository = createClinicalRepository({ $transaction: async () => { throw new Prisma.PrismaClientKnownRequestError('private SQL', { code, clientVersion: '6.12.0' }); } } as unknown as PrismaClient);
    await assert.rejects(repository.transaction('d1', 'a1', async () => true), (e: any) => e.status === status && !e.message.includes('SQL'));
  }
});
