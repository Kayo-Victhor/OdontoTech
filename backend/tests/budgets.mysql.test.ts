import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'dotenv';
import argon2 from 'argon2';
import { Prisma, PrismaClient } from '@prisma/client';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app';
import { createBudgetRepository } from '../src/repositories/budgets';
import { readClinicConfig } from '../src/config/clinic';
import { createProcedureRepository } from '../src/repositories/procedures';
import { tokenAudience, tokenIssuer } from '../src/services/auth';

const file = resolve(__dirname, '../.env.test');
const testUrl = process.env.TEST_DATABASE_URL || (existsSync(file) ? parse(readFileSync(file)).DATABASE_URL : undefined);
test('MySQL isolado: simulação lê catálogo e vínculos reais sem gravar orçamento ou alterar consultas', { skip: !testUrl && 'MySQL de testes não configurado; integração de simulação não comprovada.' }, async () => {
  const url = new URL(testUrl!);
  assert.ok(url.protocol === 'mysql:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && /^odontotech_test(?:_[a-z0-9_]+)?$/.test(decodeURIComponent(url.pathname.slice(1))), 'Use somente MySQL local odontotech_test; nunca a base de desenvolvimento.');
  const db = new PrismaClient({ datasourceUrl: testUrl }); const tag = randomUUID(); const userIds: string[] = []; const procedureIds: string[] = []; const appointmentIds: string[] = [];
  try {
    const passwordHash = await argon2.hash(randomUUID(), { type: argon2.argon2id });
    const dentist = await db.user.create({ data: { name: 'Dentista integração orçamento', email: `budget-dentist-${tag}@example.test`, passwordHash, role: 'DENTIST', dentistProfile: { create: { croNumber: tag, croState: 'SP' } } }, include: { dentistProfile: true } }); userIds.push(dentist.id);
    const admin = await db.user.create({ data: { name: 'Admin integração catálogo', email: `catalog-admin-${tag}@example.test`, passwordHash, role: 'ADMIN' } }); userIds.push(admin.id);
    const patients = [];
    for (let index = 0; index < 3; index++) { const row = await db.user.create({ data: { name: `Paciente orçamento ${index}`, email: `budget-patient-${index}-${tag}@example.test`, passwordHash, role: 'PATIENT', patientProfile: { create: {} } }, include: { patientProfile: true } }); userIds.push(row.id); patients.push(row); }
    for (let index = 0; index < 2; index++) { const row = await db.appointment.create({ data: { patientId: patients[index].patientProfile!.id, dentistId: dentist.dentistProfile!.id, createdById: dentist.id, startAt: new Date('2032-01-01T11:00:00Z'), endAt: new Date('2032-01-01T12:00:00Z'), status: index === 0 ? 'COMPLETED' : 'CANCELLED' } }); appointmentIds.push(row.id); }
    const procedure = await db.procedure.create({ data: { name: `Procedimento ${tag}`, description: 'Descrição de integração', estimatedDurationMinutes: 30 } }); procedureIds.push(procedure.id);
    const inactive = await db.procedure.create({ data: { name: `Inativo ${tag}`, estimatedDurationMinutes: 30, isActive: false } }); procedureIds.push(inactive.id);
    const config = { secret: randomBytes(32).toString('hex'), expiresInSeconds: 3600, frontendOrigin: 'http://localhost:5173', production: false, loginLimit: 100, loginWindowMs: 60000 };
    const app = createApp(config, { findByEmail: (email) => db.user.findUnique({ where: { email } }), findById: (id) => db.user.findUnique({ where: { id } }) }, undefined, undefined, readClinicConfig({}), undefined, createBudgetRepository(db), createProcedureRepository(db));
    const cookie = `odontotech_session=${jwt.sign({}, config.secret, { subject: dentist.id, issuer: tokenIssuer, audience: tokenAudience, expiresIn: 3600 })}`;
    const get = (path: string) => request(app).get(`/budget-simulations/${path}`).set('Cookie', cookie);
    const adminCookie = `odontotech_session=${jwt.sign({}, config.secret, { subject: admin.id, issuer: tokenIssuer, audience: tokenAudience, expiresIn: 3600 })}`;
    const change = (input: unknown) => request(app).patch(`/admin/procedures/${procedure.id}`).set('Cookie', adminCookie).set('Origin', config.frontendOrigin).set('X-OdontoTech-CSRF', '1').send(input);
    const simulate = (patientId: string, procedureId = procedure.id) => request(app).post('/budget-simulations/simulate').set('Cookie', cookie).set('Origin', config.frontendOrigin).set('X-OdontoTech-CSRF', '1').send({ patientId, items: [{ procedureId, quantity: 3 }], installments: 12 });
    const before = await db.appointment.findMany({ where: { id: { in: appointmentIds } }, orderBy: { id: 'asc' } });
    const clinical = await db.clinicalRecord.create({ data: { appointmentId: appointmentIds[0], authorId: dentist.id, notes: 'Notas de teste de preservação', finalizedAt: new Date(), procedures: { create: { procedureId: procedure.id, procedureNameSnapshot: procedure.name, descriptionSnapshot: procedure.description, toothOrRegion: '16' } } }, include: { procedures: true } });
    await simulate(patients[0].patientProfile!.id).expect(409);
    const adminList = await request(app).get('/admin/procedures').query({ search: tag }).set('Cookie', adminCookie).expect(200); assert.equal(adminList.body.items.length, 2); assert.ok(adminList.body.items.some((item: any) => item.defaultPrice === null)); assert.ok(adminList.body.items.some((item: any) => !item.isActive));
    await change({ defaultPrice: '33.34' }).expect(200); assert.equal((await db.procedure.findUniqueOrThrow({ where: { id: procedure.id } })).defaultPrice!.toFixed(2), '33.34');
    const list = await get('patients').expect(200); assert.deepEqual(list.body.items.map((item: any) => item.id), [patients[0].patientProfile!.id]);
    const catalog = await get(`procedures?search=${tag}`).expect(200); assert.equal(catalog.body.items.length, 1); assert.equal(catalog.body.items[0].unitPrice, '33.34');
    const created = await request(app).post('/admin/procedures').set('Cookie', adminCookie).set('Origin', config.frontendOrigin).set('X-OdontoTech-CSRF', '1').send({ name: `Zero ${tag}`, defaultPrice: '0', estimatedDurationMinutes: null }).expect(201); procedureIds.push(created.body.procedure.id); assert.equal(created.body.procedure.defaultPrice, '0.00'); assert.equal((await db.procedure.findUniqueOrThrow({ where: { id: created.body.procedure.id } })).estimatedDurationMinutes, null);
    const result = await simulate(patients[0].patientProfile!.id).expect(200); assert.equal(result.body.total, '100.02'); assert.equal(result.body.persisted, false);
    for (const plan of result.body.plans) assert.equal(plan.amounts.reduce((sum: Prisma.Decimal, amount: string) => sum.plus(amount), new Prisma.Decimal(0)).toFixed(2), '100.02');
    await simulate(patients[1].patientProfile!.id).expect(404); await simulate(patients[2].patientProfile!.id).expect(404); await simulate(patients[0].patientProfile!.id, inactive.id).expect(400);
    await change({ name: 'Novo nome do catálogo', description: 'Nova descrição', defaultPrice: '40.00', estimatedDurationMinutes: 45 }).expect(200); assert.equal(result.body.items[0].name, procedure.name);
    assert.equal((await simulate(patients[0].patientProfile!.id).expect(200)).body.total, '120.00'); assert.equal(result.body.total, '100.02');
    await change({ isActive: false }).expect(200); await simulate(patients[0].patientProfile!.id).expect(400);
    await change({ isActive: true, defaultPrice: null }).expect(200); await simulate(patients[0].patientProfile!.id).expect(409);
    await change({ defaultPrice: '0.00' }).expect(200); assert.equal((await simulate(patients[0].patientProfile!.id).expect(200)).body.total, '0.00');
    await request(app).post('/budget-simulations/simulate').set('Cookie', cookie).set('Origin', config.frontendOrigin).set('X-OdontoTech-CSRF', '1').send({ patientId: patients[0].patientProfile!.id, items: [{ procedureId: procedure.id, quantity: 1, unitPrice: '0.01' }], installments: 1, total: '0.01' }).expect(400);
    const afterClinical = await db.clinicalRecord.findUniqueOrThrow({ where: { id: clinical.id }, include: { procedures: true } }); assert.deepEqual(afterClinical, clinical);
    assert.deepEqual(await db.appointment.findMany({ where: { id: { in: appointmentIds } }, orderBy: { id: 'asc' } }), before);
    assert.equal(await db.clinicalRecord.count({ where: { appointmentId: { in: appointmentIds } } }), 1);
    await db.user.update({ where: { id: patients[0].id }, data: { status: 'INACTIVE' } }); await simulate(patients[0].patientProfile!.id).expect(404);
  } finally {
    // Apenas fixtures identificadas desta execução na base isolada validada acima.
    const records = await db.clinicalRecord.findMany({ where: { appointmentId: { in: appointmentIds } }, select: { id: true } });
    await db.clinicalProcedure.deleteMany({ where: { clinicalRecordId: { in: records.map((row) => row.id) } } }); await db.clinicalRecord.deleteMany({ where: { id: { in: records.map((row) => row.id) } } });
    await db.appointment.deleteMany({ where: { id: { in: appointmentIds } } }); await db.procedure.deleteMany({ where: { id: { in: procedureIds } } });
    await db.patientProfile.deleteMany({ where: { userId: { in: userIds } } }); await db.dentistProfile.deleteMany({ where: { userId: { in: userIds } } }); await db.user.deleteMany({ where: { id: { in: userIds } } }); await db.$disconnect();
  }
});
