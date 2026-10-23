import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import request from "supertest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { createApp } from "../src/app";
import { clinicDay, readClinicConfig } from "../src/config/clinic";
import type { AuthConfig } from "../src/config/auth";
import {
  tokenAudience,
  tokenIssuer,
  type AuthUser,
} from "../src/services/auth";
import {
  createAppointmentRepository,
  type AppointmentRepository,
  type AppointmentRow,
  type AppointmentTransaction,
} from "../src/repositories/appointments";

const config: AuthConfig = {
  secret: randomBytes(32).toString("hex"),
  expiresInSeconds: 3600,
  frontendOrigin: "http://localhost:5173",
  production: false,
  loginLimit: 100,
  loginWindowMs: 60000,
};
const clinic = readClinicConfig({});
const input = {
  patientId: "p1",
  dentistId: "d1",
  startAt: "2026-11-01T08:00:00-03:00",
  endAt: "2026-11-01T09:00:00-03:00",
  reason: "Avaliação",
};
function row(overrides: Partial<AppointmentRow> = {}): AppointmentRow {
  return {
    id: "a1",
    patientId: "p1",
    dentistId: "d1",
    startAt: new Date(input.startAt),
    endAt: new Date(input.endAt),
    status: "SCHEDULED",
    reason: "Avaliação",
    cancellationReason: null,
    patient: {
      id: "p1",
      userId: "patient-1",
      user: { name: "Paciente Teste" },
    },
    dentist: {
      id: "d1",
      userId: "dentist-1",
      user: { name: "Dentista Teste" },
    },
    ...overrides,
  };
}
function setup() {
  let actor: AuthUser = {
    id: "admin",
    name: "Admin",
    email: "test@example.test",
    passwordHash: "",
    role: "ADMIN",
    status: "ACTIVE",
  };
  const rows: AppointmentRow[] = [];
  let lastExclude: string | undefined;
  const locks: string[][] = [];
  const tx: AppointmentTransaction = {
    find: async (id) => rows.find((r) => r.id === id) || null,
    patientExists: async (id) => ["p1", "p2"].includes(id),
    dentistExists: async (id) => ["d1", "d2"].includes(id),
    overlaps: async (dentistId, startAt, endAt, exclude) => {
      lastExclude = exclude;
      return rows.some(
        (a) =>
          a.id !== exclude &&
          a.dentistId === dentistId &&
          a.status !== "CANCELLED" &&
          a.startAt < endAt &&
          a.endAt > startAt,
      );
    },
    insert: async (data) => {
      const value = row({
        ...data,
        id: `a${rows.length + 1}`,
        patient: {
          id: data.patientId,
          userId: data.patientId === "p1" ? "patient-1" : "patient-2",
          user: { name: "Paciente Teste" },
        },
        dentist: {
          id: data.dentistId,
          userId: data.dentistId === "d1" ? "dentist-1" : "dentist-2",
          user: { name: "Dentista Teste" },
        },
      });
      rows.push(value);
      return value;
    },
    update: async (id, data) => {
      const i = rows.findIndex((r) => r.id === id);
      rows[i] = { ...rows[i], ...data };
      return rows[i];
    },
  };
  const repository: AppointmentRepository = {
    find: tx.find,
    list: async ({ start, end, actor: a, dentistId, status }) =>
      rows.filter(
        (r) =>
          r.startAt < end &&
          r.endAt > start &&
          (!dentistId || r.dentistId === dentistId) &&
          (!status || r.status === status) &&
          (a.role !== "PATIENT" || r.patient.userId === a.id) &&
          (a.role !== "DENTIST" || r.dentist.userId === a.id),
      ),
    options: async () => ({
      items: [{ id: "d1", name: "Dentista Teste" }],
      hasMore: false,
    }),
    transaction: async (ids, _id, work) => {
      locks.push(ids);
      return work(tx);
    },
  };
  const app = createApp(
    config,
    { findByEmail: async () => actor, findById: async () => actor },
    undefined,
    repository,
    clinic,
  );
  const token = jwt.sign({}, config.secret, {
    subject: "test",
    issuer: tokenIssuer,
    audience: tokenAudience,
    expiresIn: 3600,
  });
  function get(path: string, authenticated = true) {
    const r = request(app).get(path);
    return authenticated ? r.set("Cookie", `odontotech_session=${token}`) : r;
  }
  function write(
    method: "post" | "patch",
    path: string,
    body: unknown,
    authenticated = true,
  ) {
    const r = request(app)
      [method](path)
      .set("Origin", config.frontendOrigin)
      .set("X-OdontoTech-CSRF", "1");
    if (authenticated) r.set("Cookie", `odontotech_session=${token}`);
    return r.send(body);
  }
  return {
    app,
    rows,
    locks,
    repository,
    get,
    write,
    lastExclude: () => lastExclude,
    actor: (role: AuthUser["role"], id: string = role.toLowerCase()) => {
      actor = { ...actor, role, id };
    },
  };
}
test("ADMIN e RECEPTIONIST criam consulta SCHEDULED com autor controlado", async () => {
  for (const role of ["ADMIN", "RECEPTIONIST"] as const) {
    const s = setup();
    s.actor(role);
    const r = await s.write("post", "/appointments", input).expect(201);
    assert.equal(r.body.appointment.status, "SCHEDULED");
    assert.equal(s.locks[0][0], "d1");
    assert.equal(r.body.appointment.createdById, undefined);
    assert.equal(r.body.appointment.dentist.userId, undefined);
  }
});
test("criação exige sessão e papel operacional; CSRF é preservado", async () => {
  const s = setup();
  await s.write("post", "/appointments", input, false).expect(401);
  for (const role of ["PATIENT", "DENTIST"] as const) {
    s.actor(role);
    await s.write("post", "/appointments", input).expect(403);
  }
  await request(s.app).post("/appointments").send(input).expect(403);
});
test("valida perfis existentes, intervalo, formato de fuso e campos internos", async () => {
  const s = setup();
  for (const body of [
    { ...input, patientId: "missing" },
    { ...input, dentistId: "missing" },
    { ...input, endAt: input.startAt },
    { ...input, startAt: "2026-11-01T08:00:00" },
    { ...input, createdById: "injected" },
    { ...input, status: "COMPLETED" },
    { ...input, patientId: "admin" },
  ])
    await s.write("post", "/appointments", body).expect(400);
  assert.equal(s.rows.length, 0);
});
test("sobreposição dentro, parcial, envolvente e no início é rejeitada", async () => {
  const s = setup();
  s.rows.push(row());
  for (const [startAt, endAt] of [
    ["08:10", "08:20"],
    ["08:30", "09:30"],
    ["07:30", "08:30"],
    ["07:00", "10:00"],
  ]) {
    await s
      .write("post", "/appointments", {
        ...input,
        startAt: `2026-11-01T${startAt}:00-03:00`,
        endAt: `2026-11-01T${endAt}:00-03:00`,
      })
      .expect(409);
  }
});
test("consecutivas e outro dentista são aceites", async () => {
  const s = setup();
  s.rows.push(row());
  await s
    .write("post", "/appointments", {
      ...input,
      startAt: input.endAt,
      endAt: "2026-11-01T10:00:00-03:00",
    })
    .expect(201);
  await s
    .write("post", "/appointments", { ...input, dentistId: "d2" })
    .expect(201);
});
test("cancelar preserva histórico e permite reutilizar horário; concluído e falta bloqueiam", async () => {
  const s = setup();
  s.rows.push(row());
  await s
    .write("patch", "/appointments/a1/status", {
      status: "CANCELLED",
      cancellationReason: "Remarcação",
    })
    .expect(200);
  assert.equal(s.rows[0].cancellationReason, "Remarcação");
  assert.equal(s.rows.length, 1);
  await s.write("post", "/appointments", input).expect(201);
  assert.equal(s.rows.length, 2);
  for (const status of ["COMPLETED", "NO_SHOW"] as const) {
    const t = setup();
    t.rows.push(row({ status }));
    await t.write("post", "/appointments", input).expect(409);
  }
});
test("agenda filtra dia local, profissional, estado e intervalos que atravessam meia-noite", async () => {
  const s = setup();
  s.rows.push(
    row(),
    row({
      id: "previous",
      startAt: new Date("2026-11-01T02:00:00Z"),
      endAt: new Date("2026-11-01T03:30:00Z"),
    }),
    row({
      id: "next",
      startAt: new Date("2026-11-02T03:00:00Z"),
      endAt: new Date("2026-11-02T04:00:00Z"),
    }),
  );
  const r = await s
    .get("/appointments?date=2026-11-01&dentistId=d1&status=SCHEDULED")
    .expect(200);
  assert.equal(r.body.appointments.length, 2);
  await s.get("/appointments?date=2026-02-30").expect(400);
  await s.get("/appointments?date=2026-11-01&patientId=other").expect(400);
});
test("PATIENT e DENTIST só recebem agenda própria e não podem alargar filtros", async () => {
  const s = setup();
  s.rows.push(
    row(),
    row({
      id: "other",
      patient: { id: "p2", userId: "patient-2", user: { name: "Outro" } },
      dentist: {
        id: "d2",
        userId: "dentist-2",
        user: { name: "Outro Dentista" },
      },
    }),
  );
  for (const [role, id] of [
    ["PATIENT", "patient-1"],
    ["DENTIST", "dentist-1"],
  ] as const) {
    s.actor(role, id);
    assert.equal(
      (await s.get("/appointments?date=2026-11-01").expect(200)).body
        .appointments.length,
      1,
    );
    await s.get("/appointments/other").expect(404);
    await s.get("/appointments/a1").expect(200);
    await s.get("/appointments?date=2026-11-01&dentistId=d2").expect(403);
    await s.get("/appointments/options?kind=patients").expect(403);
  }
});
test("edição exclui a própria consulta e revalida conflitos em transação", async () => {
  const s = setup();
  s.rows.push(
    row(),
    row({
      id: "a2",
      startAt: new Date("2026-11-01T13:00:00Z"),
      endAt: new Date("2026-11-01T14:00:00Z"),
    }),
  );
  await s
    .write("patch", "/appointments/a1", { reason: "Atualizado" })
    .expect(200);
  assert.equal(s.lastExclude(), "a1");
  assert.equal(s.rows[0].reason, "Atualizado");
  await s
    .write("patch", "/appointments/a1", {
      startAt: "2026-11-01T10:00:00-03:00",
      endAt: "2026-11-01T11:00:00-03:00",
    })
    .expect(409);
  await s.write("patch", "/appointments/a1", { dentistId: "d2" }).expect(200);
  assert.deepEqual(s.locks.at(-1), ["d1", "d2"]);
  await s
    .write("patch", "/appointments/a1", { status: "COMPLETED" })
    .expect(400);
  s.actor("DENTIST");
  await s
    .write("patch", "/appointments/a1", { reason: "unallowed" })
    .expect(403);
});
test("transições são explícitas, estados terminais não aceitam edição", async () => {
  const s = setup();
  s.rows.push(row());
  await s
    .write("patch", "/appointments/a1/status", { status: "COMPLETED" })
    .expect(409);
  for (const status of ["CONFIRMED", "WAITING", "IN_PROGRESS", "COMPLETED"])
    await s.write("patch", "/appointments/a1/status", { status }).expect(200);
  await s
    .write("patch", "/appointments/a1/status", { status: "CANCELLED" })
    .expect(409);
  await s
    .write("patch", "/appointments/a1", { reason: "late edit" })
    .expect(409);
});
test("dentista só inicia e conclui as próprias consultas; paciente não modifica estado", async () => {
  const s = setup();
  s.rows.push(row({ status: "WAITING" }));
  s.actor("PATIENT", "patient-1");
  await s
    .write("patch", "/appointments/a1/status", { status: "IN_PROGRESS" })
    .expect(403);
  s.actor("DENTIST", "dentist-2");
  await s
    .write("patch", "/appointments/a1/status", { status: "IN_PROGRESS" })
    .expect(404);
  s.actor("DENTIST", "dentist-1");
  await s
    .write("patch", "/appointments/a1/status", { status: "CANCELLED" })
    .expect(403);
  await s
    .write("patch", "/appointments/a1/status", { status: "IN_PROGRESS" })
    .expect(200);
  await s
    .write("patch", "/appointments/a1/status", { status: "COMPLETED" })
    .expect(200);
});
test("opções operacionais e configuração são autenticadas e paginadas", async () => {
  const s = setup();
  await s.get("/appointments/config", false).expect(401);
  assert.equal(
    (await s.get("/appointments/config").expect(200)).body.timeZone,
    "America/Sao_Paulo",
  );
  await s
    .get("/appointments/options?kind=dentists&page=1&pageSize=20")
    .expect(200);
  await s.get("/appointments/options?kind=admin").expect(400);
});
test("dias locais respeitam limites UTC e dias de 23 e 25 horas", () => {
  const day = clinicDay("2026-11-01", clinic);
  assert.equal(day.start.toISOString(), "2026-11-01T03:00:00.000Z");
  assert.equal(day.end.toISOString(), "2026-11-02T03:00:00.000Z");
  const ny = { ...clinic, timeZone: "America/New_York" };
  const spring = clinicDay("2026-03-08", ny);
  assert.equal((+spring.end - +spring.start) / 3600000, 23);
  const fall = clinicDay("2026-11-01", ny);
  assert.equal((+fall.end - +fall.start) / 3600000, 25);
  assert.throws(() => readClinicConfig({ CLINIC_TIMEZONE: "Invalid/Zone" }));
});
test("repositório bloqueia dentistas em ordem, depois consulta, com READ COMMITTED antes da escrita", async () => {
  const events: string[] = [];
  let transactionConfig: unknown;
  const tx = {
    $queryRaw: async (_sql: TemplateStringsArray, id: string) => {
      events.push(`lock:${id}`);
      return [{ id }];
    },
  };
  const database = {
    $transaction: async (
      work: (tx: unknown) => Promise<unknown>,
      options: unknown,
    ) => {
      transactionConfig = options;
      return work(tx);
    },
  } as unknown as PrismaClient;
  const repository = createAppointmentRepository(database);
  await repository.transaction(["d2", "d1", "d2"], "a1", async () => {
    events.push("write");
  });
  assert.deepEqual(events, ["lock:d1", "lock:d2", "lock:a1", "write"]);
  assert.deepEqual(transactionConfig, {
    isolationLevel: "ReadCommitted",
    maxWait: 5000,
    timeout: 10000,
  });
});
test("repositório aplica âmbito no SQL e converte deadlocks e timeouts em erro controlado", async () => {
  let where: Prisma.AppointmentWhereInput | undefined;
  const database = {
    appointment: {
      findMany: async (args: Prisma.AppointmentFindManyArgs) => {
        where = args.where;
        return [];
      },
    },
    $transaction: async () => {
      throw new Prisma.PrismaClientKnownRequestError("private SQL details", {
        code: "P2034",
        clientVersion: "6.12.0",
      });
    },
  } as unknown as PrismaClient;
  const repo = createAppointmentRepository(database);
  await repo.list({
    ...clinicDay("2026-11-01", clinic),
    actor: { id: "patient-1", name: "Patient", role: "PATIENT" },
  });
  assert.deepEqual(where?.patient, { userId: "patient-1" });
  await assert.rejects(
    repo.transaction(["d1"], undefined, async () => {}),
    (e: unknown) =>
      typeof e === "object" && e !== null && "status" in e && e.status === 409,
  );
});
