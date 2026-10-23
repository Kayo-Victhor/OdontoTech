import { rateLimit } from 'express-rate-limit';

export function attemptLimiter(limit: number, windowMs: number) {
  return rateLimit({
    windowMs, limit, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { message: 'Muitas tentativas. Aguarde antes de tentar novamente.' },
  });
}
