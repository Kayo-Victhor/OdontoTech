import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import express from 'express';
import { createApp } from '../src/app';
import { readAuthConfig, type AuthConfig } from '../src/config/auth';
import { createAuthService, tokenAudience, tokenIssuer, type AuthUser, type UserRepository } from '../src/services/auth';
import { authenticate, authorize } from '../src/middlewares/auth';

const password = 'Test-Only-Password!123';
const config: AuthConfig = { secret: randomBytes(32).toString('hex'), expiresInSeconds: 3600, frontendOrigin: 'http://localhost:5173', production: false, loginLimit: 100, loginWindowMs: 60000 };
let hash: string;
before(async () => { hash = await argon2.hash(password, { type: argon2.argon2id }); });
function setup(overrides: Partial<AuthConfig> = {}) {
  let user: AuthUser | null = { id: 'user-1', name: 'Teste Admin', email: 'admin@example.test', passwordHash: hash, role: 'ADMIN', status: 'ACTIVE' };
  const users: UserRepository = {
    findByEmail: async (email) => user?.email === email ? user : null,
    findById: async (id) => user?.id === id ? user : null,
  };
  const settings = { ...config, ...overrides };
  const app = createApp(settings, users);
  const login = (body: unknown = { email: 'admin@example.test', password }) => request(app).post('/auth/login').set('Origin', settings.frontendOrigin).set('X-OdontoTech-CSRF', '1').send(body);
  return { app, login, users, setUser: (value: AuthUser | null) => { user = value; }, getUser: () => user! };
}
function sessionCookie(response: request.Response): string {
  return (response.headers['set-cookie'] as unknown as string[])[0].split(';')[0];
}

test('login normaliza e-mail, verifica Argon2id e emite cookie; JSON só tem dados públicos', async () => {
  const s = setup();
  const result = await s.login({ email: '  ADMIN@EXAMPLE.TEST ', password, role: 'PATIENT' }).expect(200);
  assert.deepEqual(result.body, { user: { id: 'user-1', name: 'Teste Admin', role: 'ADMIN' } });
  const cookie = result.headers['set-cookie'][0];
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Lax/); assert.match(cookie, /Max-Age=3600/);
  const claims = jwt.verify(sessionCookie(result).split('=')[1], config.secret, { algorithms: ['HS256'], audience: tokenAudience, issuer: tokenIssuer });
  assert.equal(typeof claims === 'object' && claims.sub, 'user-1');
  assert.deepEqual(Object.keys(claims).sort(), ['aud', 'exp', 'iat', 'iss', 'sub']);
  assert.equal(s.getUser().passwordHash, hash);
});
for (const role of ['ADMIN', 'RECEPTIONIST', 'DENTIST', 'PATIENT'] as const) {
  test(`login de ${role} verifica credenciais próprias e ignora perfil divergente do cliente`, async () => {
    const s = setup();
    const user = { ...s.getUser(), id: role.toLowerCase(), role, email: `${role.toLowerCase()}@example.test` };
    s.setUser(user);
    const response = await s.login({ email: user.email, password, role: role === 'ADMIN' ? 'DENTIST' : 'ADMIN' }).expect(200);
    assert.deepEqual(response.body.user, { id: user.id, name: user.name, role });
    const me = await request(s.app).get('/auth/me').set('Cookie', sessionCookie(response)).expect(200);
    assert.equal(me.body.user.role, role);
    assert.equal(me.body.user.id, user.id);
    await s.login({ email: user.email, password: 'incorrect', role: 'ADMIN' }).expect(401);
  });
}
test('senha incorreta, e-mail inexistente, conta inativa e hash inválido recebem o mesmo 401 sem cookie', async () => {
  const s = setup();
  for (const body of [{ email: 'admin@example.test', password: 'incorrect' }, { email: 'missing@example.test', password }]) {
    const r = await s.login(body).expect(401);
    assert.deepEqual(r.body, { message: 'E-mail ou senha inválidos' }); assert.equal(r.headers['set-cookie'], undefined);
  }
  s.setUser({ ...s.getUser(), status: 'INACTIVE' });
  assert.deepEqual((await s.login().expect(401)).body, { message: 'E-mail ou senha inválidos' });
  for (const passwordHash of ['invalid', '$argon2id$broken']) {
    s.setUser({ ...s.getUser(), status: 'ACTIVE', passwordHash });
    const r = await s.login().expect(401); assert.equal(r.headers['set-cookie'], undefined);
  }
});
test('entrada ausente ou inválida é recusada sem token', async () => {
  const s = setup();
  for (const body of [{}, { email: 'bad', password }, { email: 'admin@example.test' }, { email: 'admin@example.test', password: '' }, { email: [], password }]) {
    const r = await s.login(body).expect(400); assert.equal(r.headers['set-cookie'], undefined);
  }
});
test('/me restaura sessão e usa papel/estado atuais no banco', async () => {
  const s = setup();
  await request(s.app).get('/auth/me').expect(401);
  const cookie = sessionCookie(await s.login().expect(200));
  await request(s.app).get('/auth/me').set('Cookie', cookie).expect(200);
  s.setUser({ ...s.getUser(), role: 'DENTIST' });
  const r = await request(s.app).get('/auth/me').set('Cookie', cookie).expect(200);
  assert.equal(r.body.user.role, 'DENTIST');
  assert.equal(r.body.user.passwordHash, undefined);
  s.setUser({ ...s.getUser(), status: 'INACTIVE' });
  await request(s.app).get('/auth/me').set('Cookie', cookie).expect(401);
  s.setUser(null);
  await request(s.app).get('/auth/me').set('Cookie', cookie).expect(401);
});
test('recusa tokens malformados, expirados, assinatura/algoritmo/claims incorretos', async () => {
  const s = setup();
  const base = { subject: 'user-1', issuer: tokenIssuer, audience: tokenAudience, expiresIn: 3600 };
  const tokens = [
    'malformed', '%broken',
    jwt.sign({}, config.secret, { ...base, expiresIn: -1 }),
    jwt.sign({}, randomBytes(32).toString('hex'), base),
    jwt.sign({}, config.secret, { ...base, algorithm: 'HS384' }),
    jwt.sign({}, config.secret, { ...base, issuer: 'other' }),
    jwt.sign({}, config.secret, { ...base, audience: 'other' }),
    jwt.sign({}, config.secret, { subject: 'user-1', issuer: tokenIssuer, audience: tokenAudience }),
    jwt.sign({ iat: Math.floor(Date.now() / 1000) + 100 }, config.secret, base),
  ];
  for (const token of tokens) await request(s.app).get('/auth/me').set('Cookie', `odontotech_session=${token}`).expect(401);
});
test('logout apaga cookie, incluindo quando sessão expirou; não aceita CSRF', async () => {
  const s = setup(); const agent = request.agent(s.app);
  await agent.post('/auth/login').set('Origin', config.frontendOrigin).set('X-OdontoTech-CSRF', '1').send({ email: 'admin@example.test', password }).expect(200);
  await agent.get('/auth/me').expect(200);
  await agent.post('/auth/logout').expect(403);
  await agent.post('/auth/logout').set('Origin', config.frontendOrigin).set('X-OdontoTech-CSRF', '1').expect(204);
  await agent.get('/auth/me').expect(401);
  const r = await s.login().expect(200);
  assert.equal(r.headers['cache-control'], 'no-store');
});
test('cookie de produção é Secure e usa prefixo __Host-', async () => {
  const s = setup({ production: true, frontendOrigin: 'https://clinic.example.test' });
  const r = await s.login().expect(200);
  assert.match(r.headers['set-cookie'][0], /^__Host-odontotech_session=/);
  assert.match(r.headers['set-cookie'][0], /; Secure/);
});
test('rate limiting bloqueia tentativas efetivamente', async () => {
  const s = setup({ loginLimit: 2 });
  await s.login({}).expect(400); await s.login({}).expect(400);
  const r = await s.login({}).expect(429);
  assert.ok(r.headers['retry-after']); assert.equal(r.headers['set-cookie'], undefined);
});
test('CSRF bloqueia login de outra origem ou sem cabeçalho', async () => {
  const s = setup();
  await request(s.app).post('/auth/login').set('Origin', 'https://evil.example').set('X-OdontoTech-CSRF', '1').send({ email: 'admin@example.test', password }).expect(403);
  await request(s.app).post('/auth/login').set('Origin', config.frontendOrigin).send({ email: 'admin@example.test', password }).expect(403);
});
test('autorização utiliza identidade validada e recusa papel indevido', async () => {
  const s = setup(); const app = express();
  app.get('/private', authenticate(createAuthService(config, s.users), config), authorize('ADMIN'), (_req, res) => { res.json({ ok: true }); });
  app.use((error: { status: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => { res.sendStatus(error.status); });
  const cookie = sessionCookie(await s.login());
  await request(app).get('/private').set('Cookie', cookie).expect(200);
  s.setUser({ ...s.getUser(), role: 'PATIENT' });
  await request(app).get('/private').set('Cookie', cookie).expect(403);
  await request(app).get('/private').expect(401);
});
test('configuração falha sem segredo, segredo fraco ou origem insegura em produção', () => {
  for (const secret of [undefined, 'short', 'a'.repeat(64)]) assert.throws(() => readAuthConfig({ JWT_SECRET: secret }));
  assert.throws(() => readAuthConfig({ JWT_SECRET: config.secret, NODE_ENV: 'production', FRONTEND_ORIGIN: 'http://localhost:5173' }));
  assert.equal(readAuthConfig({ JWT_SECRET: config.secret }).expiresInSeconds, 3600);
});
