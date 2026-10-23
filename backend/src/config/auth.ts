export interface AuthConfig {
  secret: string;
  expiresInSeconds: number;
  frontendOrigin: string;
  production: boolean;
  loginLimit: number;
  loginWindowMs: number;
  registrationLimit?: number;
  registrationWindowMs?: number;
}
function positiveInteger(value: string | undefined, fallback: number, name: string) {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error(`${name} deve ser um inteiro positivo.`);
  return number;
}
export function readAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const secret = env.JWT_SECRET;
  if (!secret || !/^[a-fA-F0-9]{64,}$/.test(secret) || new Set(secret.toLowerCase()).size < 8) {
    throw new Error('Configure JWT_SECRET com pelo menos 32 bytes aleatórios codificados em hexadecimal (64 caracteres).');
  }
  if (secret === env.DB_PASSWORD) throw new Error('JWT_SECRET deve ser distinto da senha MySQL.');
  const production = env.NODE_ENV === 'production';
  const origin = env.FRONTEND_ORIGIN || (production ? '' : 'http://localhost:5173');
  let url: URL;
  try { url = new URL(origin); } catch { throw new Error('FRONTEND_ORIGIN deve conter a origem do frontend.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin || (production && url.protocol !== 'https:')) {
    throw new Error('FRONTEND_ORIGIN deve ser uma origem válida, sem caminho e com HTTPS em produção.');
  }
  return {
    secret, production, frontendOrigin: origin,
    expiresInSeconds: positiveInteger(env.JWT_EXPIRES_IN_SECONDS, 3600, 'JWT_EXPIRES_IN_SECONDS'),
    loginLimit: positiveInteger(env.LOGIN_RATE_LIMIT_MAX, 10, 'LOGIN_RATE_LIMIT_MAX'),
    loginWindowMs: positiveInteger(env.LOGIN_RATE_LIMIT_WINDOW_MS, 900000, 'LOGIN_RATE_LIMIT_WINDOW_MS'),
    registrationLimit: positiveInteger(env.REGISTER_RATE_LIMIT_MAX, 5, 'REGISTER_RATE_LIMIT_MAX'),
    registrationWindowMs: positiveInteger(env.REGISTER_RATE_LIMIT_WINDOW_MS, 900000, 'REGISTER_RATE_LIMIT_WINDOW_MS'),
  };
}
