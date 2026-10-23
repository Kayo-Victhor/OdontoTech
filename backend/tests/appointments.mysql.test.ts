import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { parse } from "dotenv";
import { existsSync, readFileSync } from 'node:fs';
import argon2 from 'argon2';
import { PrismaClient } from "@prisma/client";
import { createAppointmentRepository } from "../src/repositories/appointments";
import { createAppointmentService } from "../src/services/appointments";
import { readClinicConfig } from "../src/config/clinic";

const testFile = resolve(__dirname, '../.env.test');
const testUrl = process.env.TEST_DATABASE_URL || (existsSync(testFile) ? parse(readFileSync(testFile)).DATABASE_URL : undefined);
test(
  "MySQL isolado: criações e edições concorrentes não confirmam intervalos incompatíveis",
  {
    skip:
      !testUrl &&
      "TEST_DATABASE_URL não configurada; concorrência MySQL não comprovada.",
  },
  async () => {
    const url = new URL(testUrl!);
    const name = decodeURIComponent(url.pathname.slice(1));
    assert.ok(
      url.protocol === "mysql:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
        /^odontotech_test(?:_[a-z0-9_]+)?$/.test(name),
      "Use MySQL local e base isolada odontotech_test_<sufixo>; nunca odontotech.",
    );
    const db = new PrismaClient({ datasourceUrl: testUrl });
    const tag = randomUUID();
    const userIds: string[] = [];
    let adminId: string | undefined;
    let dentistId: string | undefined;
    let patientId: string | undefined;
    try {
      const passwordHash = await argon2.hash(randomUUID(), { type: argon2.argon2id });
      const engines = await db.$queryRaw<
        { TABLE_NAME: string; ENGINE: string }[]
      >`SELECT TABLE_NAME, ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('Appointment', 'DentistProfile')`;
      assert.equal(
        engines.length,
        2,
        "Aplique as migrations existentes apenas na base isolada antes dos testes.",
      );
      assert.ok(engines.every((row) => row.ENGINE === "InnoDB"));
      const admin = await db.user.create({
        data: {
          name: "Integração Admin",
          email: `admin-${tag}@example.test`,
          passwordHash,
          role: "ADMIN",
        },
      });
      userIds.push(admin.id);
      adminId = admin.id;
      const patient = await db.user.create({
        data: {
          name: "Integração Paciente",
          email: `patient-${tag}@example.test`,
          passwordHash,
          role: "PATIENT",
          patientProfile: { create: {} },
        },
        include: { patientProfile: true },
      });
      userIds.push(patient.id);
      patientId = patient.patientProfile!.id;
      const dentist = await db.user.create({
        data: {
          name: "Integração Dentista",
          email: `dentist-${tag}@example.test`,
          passwordHash,
          role: "DENTIST",
          dentistProfile: { create: { croNumber: tag, croState: "SP" } },
        },
        include: { dentistProfile: true },
      });
      userIds.push(dentist.id);
      dentistId = dentist.dentistProfile!.id;
      const service = createAppointmentService(
        createAppointmentRepository(db),
        readClinicConfig({}),
      );
      const actor = { id: adminId, name: admin.name, role: "ADMIN" as const };
      const input = {
        patientId,
        dentistId,
        startAt: "2030-01-10T08:00:00-03:00",
        endAt: "2030-01-10T09:00:00-03:00",
      };
      const results = await Promise.allSettled([
        service.create(input, actor),
        service.create(input, actor),
      ]);
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      const rejected = results.find(
        (r) => r.status === "rejected",
      ) as PromiseRejectedResult;
      assert.equal(rejected.reason.status, 409);
      assert.equal(await db.appointment.count({ where: { dentistId } }), 1);
      const first = await db.appointment.findFirstOrThrow({
        where: { dentistId },
      });
      const second = await service.create(
        { ...input, startAt: input.endAt, endAt: "2030-01-10T10:00:00-03:00" },
        actor,
      );
      const edits = await Promise.allSettled([
        service.edit(
          first.id,
          {
            startAt: "2030-01-10T11:00:00-03:00",
            endAt: "2030-01-10T12:00:00-03:00",
          },
          actor,
        ),
        service.edit(
          second.id,
          {
            startAt: "2030-01-10T11:00:00-03:00",
            endAt: "2030-01-10T12:00:00-03:00",
          },
          actor,
        ),
      ]);
      assert.equal(edits.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal(
        (edits.find((r) => r.status === "rejected") as PromiseRejectedResult)
          .reason.status,
        409,
      );
      await service.changeStatus(first.id, { status: "CANCELLED" }, actor);
      assert.equal(
        (await db.appointment.findUniqueOrThrow({ where: { id: first.id } }))
          .status,
        "CANCELLED",
      );
    } finally {
      // Somente fixtures desta execução, numa base cujo nome e host foram verificados acima.
      if (adminId)
        await db.appointment.deleteMany({ where: { createdById: adminId } });
      if (patientId)
        await db.patientProfile.delete({ where: { id: patientId } });
      if (dentistId)
        await db.dentistProfile.delete({ where: { id: dentistId } });
      if (userIds.length)
        await db.user.deleteMany({ where: { id: { in: userIds } } });
      await db.$disconnect();
    }
  },
);
