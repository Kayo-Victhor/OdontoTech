import argon2 from 'argon2';
import { UserRole, UserStatus } from '@prisma/client';
import { createDatabaseClient } from '../src/config/database';

const prisma = createDatabaseClient();
class SeedValidationError extends Error {}

function requiredValue(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new SeedValidationError(`${name} é obrigatório para executar o seed.`);
  return value;
}

function validatePassword(password: string): void {
  const strongPassword = password.length >= 12 && /[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password) && /[^A-Za-z0-9]/.test(password);
  if (!strongPassword) throw new SeedValidationError('ADMIN_PASSWORD deve ter pelo menos 12 caracteres, incluindo maiúscula, minúscula, número e símbolo.');
}

async function main() {
  const name = requiredValue('ADMIN_NAME');
  const email = requiredValue('ADMIN_EMAIL').toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!password) throw new SeedValidationError('ADMIN_PASSWORD é obrigatório para executar o seed.');
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new SeedValidationError('ADMIN_EMAIL deve ser um e-mail válido.');
  validatePassword(password);

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    if (existing.role !== UserRole.ADMIN) throw new SeedValidationError('O e-mail configurado já pertence a um utilizador sem perfil ADMIN. A conta não foi promovida automaticamente.');
    console.log('Conta administrativa já existe; credenciais e estado não foram alterados.');
    return;
  }

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  await prisma.user.create({ data: { name, email, passwordHash, role: UserRole.ADMIN, status: UserStatus.ACTIVE } });
  console.log('Conta administrativa inicial criada.');
}

main().catch((error: unknown) => {
  console.error(error instanceof SeedValidationError ? error.message : 'Não foi possível iniciar o administrador. Verifique a conexão e a disponibilidade da tabela User.');
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
