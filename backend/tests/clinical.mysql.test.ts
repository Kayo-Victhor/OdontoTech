import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import argon2 from 'argon2';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createClinicalRepository, type ClinicalRepository } from '../src/repositories/clinical';
import { createClinicalService } from '../src/services/clinical';
import { createApp } from '../src/app';
import { readClinicConfig } from '../src/config/clinic';

const file = resolve(__dirname, '../.env.test');
const testUrl = process.env.TEST_DATABASE_URL || (existsSync(file) ? parse(readFileSync(file)).DATABASE_URL : undefined);
test('MySQL clínico isolado: unicidade, rollback, snapshots, escopo e finalização concorrente', { skip: !testUrl && 'MySQL de testes não configurado; integridade concorrente não comprovada.' }, async () => {
  const url = new URL(testUrl!);
  assert.ok(url.protocol === 'mysql:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && /^odontotech_test(?:_[a-z0-9_]+)?$/.test(decodeURIComponent(url.pathname.slice(1))), 'Use somente odontotech_test local; nunca a base de desenvolvimento.');
  const db = new PrismaClient({ datasourceUrl: testUrl }); const tag = randomUUID();
  const userIds: string[] = []; const appointmentIds: string[] = []; let procedureId: string | undefined;
  try {
    const engines = await db.$queryRaw<{ TABLE_NAME: string; ENGINE: string }[]>`SELECT TABLE_NAME, ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('ClinicalRecord', 'ClinicalProcedure', 'ClinicalAddendum', 'Appointment', 'DentistProfile')`;
    assert.equal(engines.length, 5); assert.ok(engines.every((row) => row.ENGINE === 'InnoDB'));
    const passwordHash = await argon2.hash(randomUUID(), { type: argon2.argon2id });
    const patient = await db.user.create({ data: { name: 'Paciente integração clínica', email: `patient-clinical-${tag}@example.test`, passwordHash, role: 'PATIENT', patientProfile: { create: { phone: '11999999999', birthDate: new Date('2000-01-01') } } }, include: { patientProfile: true } }); userIds.push(patient.id);
    const dentist = await db.user.create({ data: { name: 'Dentista integração clínica', email: `dentist-clinical-${tag}@example.test`, passwordHash, role: 'DENTIST', dentistProfile: { create: { croNumber: tag, croState: 'SP' } } }, include: { dentistProfile: true } }); userIds.push(dentist.id);
    const other = await db.user.create({ data: { name: 'Outro dentista integração', email: `other-clinical-${tag}@example.test`, passwordHash, role: 'DENTIST', dentistProfile: { create: { croNumber: tag, croState: 'RJ' } } }, include: { dentistProfile: true } }); userIds.push(other.id);
    const createAppointment = async (dentistId: string) => { const row = await db.appointment.create({ data: { patientId: patient.patientProfile!.id, dentistId, createdById: dentist.id, startAt: new Date('2031-01-03T11:00:00Z'), endAt: new Date('2031-01-03T12:00:00Z'), status: 'IN_PROGRESS' } }); appointmentIds.push(row.id); return row; };
    const appointment = await createAppointment(dentist.dentistProfile!.id);
    const second = await createAppointment(other.dentistProfile!.id);
    const catalog = await db.procedure.create({ data: { name: 'Nome histórico integração', description: 'Descrição histórica', estimatedDurationMinutes: 30 } }); procedureId = catalog.id;
    const repository = createClinicalRepository(db); const service = createClinicalService(repository);
    const actor = { id: dentist.id, name: dentist.name, role: 'DENTIST' as const }; const patientActor = { id: patient.id, name: patient.name, role: 'PATIENT' as const };
    const starts = await Promise.all([service.start(appointment.id, actor), service.start(appointment.id, actor)]);
    assert.equal(starts[0].id, starts[1].id); assert.equal(await db.clinicalRecord.count({ where: { appointmentId: appointment.id } }), 1);
    let record = await service.save(appointment.id, { notes: 'Notas clínicas originais', expectedUpdatedAt: starts[0].updatedAt.toISOString() }, actor);
    record = await service.addProcedure(appointment.id, { procedureId, toothOrRegion: '16', expectedUpdatedAt: record.updatedAt.toISOString() }, actor);
    await db.procedure.update({ where: { id: procedureId }, data: { name: 'Nome modificado', description: 'Descrição modificada' } });
    assert.equal((await service.get(appointment.id, actor)).record!.procedures[0].procedureNameSnapshot, 'Nome histórico integração');
    assert.equal((await service.get(appointment.id, actor)).record!.procedures[0].descriptionSnapshot, 'Descrição histórica');
    assert.equal((await service.history(undefined, patientActor, { page: 1, pageSize: 10 })).items.length, 0);
    // Força falha depois do INSERT de procedimento: a transação real deve reverter o INSERT.
    const failing: ClinicalRepository = { ...repository, transaction: (dentistId, id, work) => repository.transaction(dentistId, id, (tx) => work({ ...tx, save: async () => { throw new Error('Falha de teste'); } })) };
    await assert.rejects(createClinicalService(failing).addProcedure(appointment.id, { procedureName: 'Não deve persistir', toothOrRegion: '17', expectedUpdatedAt: record.updatedAt.toISOString() }, actor));
    assert.equal(await db.clinicalProcedure.count({ where: { clinicalRecordId: record.id } }), 1);
    // Mantém finalização aberta com os locks adquiridos, antes de permitir o COMMIT.
    let entered!: () => void; let release!: () => void;
    const prepared = new Promise<void>((resolve) => { entered = resolve; }); const gate = new Promise<void>((resolve) => { release = resolve; });
    const held: ClinicalRepository = { ...repository, transaction: (dentistId, id, work) => repository.transaction(dentistId, id, async (tx) => { const result = await work(tx); entered(); await gate; return result; }) };
    const finalizing = createClinicalService(held).finalize(appointment.id, record.updatedAt.toISOString(), actor);
    await prepared;
    const changing = service.save(appointment.id, { notes: 'Não pode substituir finalizado', expectedUpdatedAt: record.updatedAt.toISOString() }, actor);
    const adding = service.addProcedure(appointment.id, { procedureName: 'Não pode acrescentar', toothOrRegion: '18', expectedUpdatedAt: record.updatedAt.toISOString() }, actor);
    release();
    const results = await Promise.allSettled([finalizing, changing, adding]);
    assert.equal(results[0].status, 'fulfilled'); for (const result of results.slice(1)) { assert.equal(result.status, 'rejected'); assert.equal((result as PromiseRejectedResult).reason.status, 409); }
    const finalized = await db.clinicalRecord.findUniqueOrThrow({ where: { id: record.id }, include: { procedures: true } });
    assert.equal(finalized.notes, 'Notas clínicas originais'); assert.ok(finalized.finalizedAt); assert.equal(finalized.procedures.length, 1); assert.equal(finalized.authorId, dentist.id);
    assert.equal((await db.appointment.findUniqueOrThrow({ where: { id: appointment.id } })).status, 'IN_PROGRESS');
    const original = { notes: finalized.notes, finalizedAt: finalized.finalizedAt, updatedAt: finalized.updatedAt, authorId: finalized.authorId };
    await service.addendum(appointment.id, 'Complemento preservando original', actor);
    const after = await db.clinicalRecord.findUniqueOrThrow({ where: { id: record.id } }); assert.deepEqual({ notes: after.notes, finalizedAt: after.finalizedAt, updatedAt: after.updatedAt, authorId: after.authorId }, original);
    assert.equal((await db.clinicalAddendum.findFirstOrThrow({ where: { clinicalRecordId: record.id } })).authorId, dentist.id);
    await assert.rejects(service.get(appointment.id, { id: other.id, name: other.name, role: 'DENTIST' }), (e: any) => e.status === 404);
    await service.start(second.id, { id: other.id, name: other.name, role: 'DENTIST' });
    assert.equal((await service.history(appointment.id, actor, { page: 1, pageSize: 10 })).items.length, 1);
    const history = await service.history(undefined, patientActor, { page: 1, pageSize: 10 }); assert.equal(history.items.length, 1); assert.equal(history.items[0].addenda.length, 1);
    assert.equal((await service.history(undefined, { ...patientActor, id: 'not-this-patient' }, { page: 1, pageSize: 10 })).items.length, 0);
    // Pipeline HTTP real -> serviço -> Prisma -> MySQL; token criado só na memória do teste.
    const config = { secret: randomBytes(32).toString('hex'), expiresInSeconds: 3600, frontendOrigin: 'http://localhost:5173', production: false, loginLimit: 100, loginWindowMs: 60000 };
    const app = createApp(config, { findById: (id) => db.user.findUnique({ where: { id } }), findByEmail: (email) => db.user.findUnique({ where: { email } }) }, undefined, undefined, readClinicConfig({}), repository);
    const jwt = await import('jsonwebtoken'); const { tokenIssuer, tokenAudience } = await import('../src/services/auth');
    const token = jwt.default.sign({}, config.secret, { subject: patient.id, issuer: tokenIssuer, audience: tokenAudience, expiresIn: 3600 });
    const response = await request(app).get('/clinical/history').set('Cookie', `odontotech_session=${token}`).expect(200);
    assert.equal(response.body.items.length, 1); assert.equal(response.body.items[0].authorId, undefined); assert.equal(response.headers['cache-control'], 'no-store');
  } finally {
    // Remoção restrita às fixtures exclusivas desta execução na base isolada validada acima.
    const rows = await db.clinicalRecord.findMany({ where: { appointmentId: { in: appointmentIds } }, select: { id: true } }); const ids = rows.map((r) => r.id);
    await db.clinicalAddendum.deleteMany({ where: { clinicalRecordId: { in: ids } } });
    await db.clinicalProcedure.deleteMany({ where: { clinicalRecordId: { in: ids } } });
    await db.clinicalRecord.deleteMany({ where: { id: { in: ids } } });
    await db.appointment.deleteMany({ where: { id: { in: appointmentIds } } });
    if (procedureId) await db.procedure.delete({ where: { id: procedureId } });
    await db.patientProfile.deleteMany({ where: { userId: { in: userIds } } }); await db.dentistProfile.deleteMany({ where: { userId: { in: userIds } } }); await db.user.deleteMany({ where: { id: { in: userIds } } });
    await db.$disconnect();
  }
});
