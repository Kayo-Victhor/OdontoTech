import type { RequestHandler, CookieOptions } from 'express';
import type { UserRole } from '@prisma/client';
import type { AuthService, PublicUser } from '../services/auth';
import type { AuthConfig } from '../config/auth';
import { HttpError } from '../utils/http-error';

export function cookieName(config: AuthConfig) { return config.production ? '__Host-odontotech_session' : 'odontotech_session'; }
export function cookieOptions(config: AuthConfig): CookieOptions {
  return { httpOnly: true, secure: config.production, sameSite: 'lax', path: '/' };
}
function readCookie(header: string | undefined, name: string) {
  const pair = header?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  if (!pair) return undefined;
  try { return decodeURIComponent(pair.slice(name.length + 1)); } catch { return undefined; }
}
export function authenticate(service: AuthService, config: AuthConfig): RequestHandler {
  return async (req, res, next) => {
    try {
      res.locals.user = await service.authenticate(readCookie(req.headers.cookie, cookieName(config)));
      next();
    } catch (error) { next(error); }
  };
}
export function authorize(...roles: UserRole[]): RequestHandler {
  return (_req, res, next) => {
    const user = res.locals.user as PublicUser | undefined;
    if (!user) return next(new HttpError(401, 'Sessão inválida ou expirada'));
    if (!roles.includes(user.role)) return next(new HttpError(403, 'Acesso não autorizado'));
    next();
  };
}
export function protectCsrf(config: AuthConfig): RequestHandler {
  return (req, _res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    // Origem exata + cabeçalho não simples impedem pedidos forjados de outros sites.
    if (req.get('origin') !== config.frontendOrigin || req.get('x-odontotech-csrf') !== '1') {
      return next(new HttpError(403, 'Origem da requisição não autorizada'));
    }
    next();
  };
}
