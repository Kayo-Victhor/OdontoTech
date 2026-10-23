import argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { UserRole, UserStatus } from '@prisma/client';
import type { AuthConfig } from '../config/auth';
import { HttpError } from '../utils/http-error';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  passwordHash: string;
}
export type PublicUser = Pick<AuthUser, 'id' | 'name' | 'role'>;
export interface UserRepository {
  findByEmail(email: string): Promise<AuthUser | null>;
  findById(id: string): Promise<AuthUser | null>;
}
export function publicUser(user: AuthUser): PublicUser { return { id: user.id, name: user.name, role: user.role }; }
export const tokenIssuer = 'odontotech-api';
export const tokenAudience = 'odontotech-web';
export function createAuthService(config: AuthConfig, users: UserRepository) {
  const dummyHash = argon2.hash(randomBytes(32), { type: argon2.argon2id });
  return {
    async login(email: string, password: string) {
      const user = await users.findByEmail(email.trim().toLowerCase());
      const hash = user?.passwordHash.startsWith('$argon2id$') ? user.passwordHash : await dummyHash;
      let valid = false;
      try { valid = await argon2.verify(hash, password); } catch { /* Hash inválido nunca permite acesso. */ }
      if (!user || user.status !== 'ACTIVE' || !user.passwordHash.startsWith('$argon2id$') || !valid) {
        throw new HttpError(401, 'E-mail ou senha inválidos');
      }
      const token = jwt.sign({}, config.secret, {
        algorithm: 'HS256', subject: user.id, expiresIn: config.expiresInSeconds,
        issuer: tokenIssuer, audience: tokenAudience,
      });
      return { user: publicUser(user), token };
    },
    async authenticate(token: string | undefined) {
      if (!token) throw new HttpError(401, 'Sessão inválida ou expirada');
      let subject: string;
      try {
        const claims = jwt.verify(token, config.secret, {
          algorithms: ['HS256'], issuer: tokenIssuer, audience: tokenAudience, maxAge: config.expiresInSeconds,
        });
        if (typeof claims === 'string' || typeof claims.sub !== 'string' || !claims.sub ||
          typeof claims.exp !== 'number' || typeof claims.iat !== 'number' || claims.iat > Math.floor(Date.now() / 1000) + 5) throw new Error();
        subject = claims.sub;
      } catch { throw new HttpError(401, 'Sessão inválida ou expirada'); }
      const user = await users.findById(subject);
      if (!user || user.status !== 'ACTIVE') throw new HttpError(401, 'Sessão inválida ou expirada');
      return publicUser(user);
    },
  };
}
export type AuthService = ReturnType<typeof createAuthService>;
