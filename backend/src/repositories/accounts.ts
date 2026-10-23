import { Prisma, type PrismaClient, type UserRole, type UserStatus } from '@prisma/client';

export interface CreatedAccount { id: string; name: string; role: UserRole }
export interface ListedAccount extends CreatedAccount { email: string; status: UserStatus; createdAt: Date }
export interface CreateAccountData {
  name: string;
  email: string;
  passwordHash: string;
  role: 'PATIENT' | 'RECEPTIONIST' | 'DENTIST';
  patientProfile?: { phone?: string; birthDate?: Date };
  dentistProfile?: { croNumber: string; croState: string; specialty?: string };
}
export interface AccountRepository {
  create(data: CreateAccountData): Promise<CreatedAccount>;
  list(page: number, pageSize: number): Promise<{ users: ListedAccount[]; total: number }>;
}
export class AccountConflictError extends Error {}
export function createAccountRepository(database: PrismaClient): AccountRepository {
  return {
    async create(input) {
      try {
        // Nested writes são transacionais: falha em qualquer perfil desfaz a conta.
        return await database.user.create({
          data: {
            name: input.name, email: input.email, passwordHash: input.passwordHash,
            role: input.role, status: 'ACTIVE',
            ...(input.patientProfile ? { patientProfile: { create: input.patientProfile } } : {}),
            ...(input.dentistProfile ? { dentistProfile: { create: input.dentistProfile } } : {}),
          },
          select: { id: true, name: true, role: true },
        });
      } catch (error: unknown) {
        // A restrição UNIQUE é a garantia final, inclusive para pedidos concorrentes.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new AccountConflictError('E-mail ou inscrição profissional já utilizados.');
        }
        throw error;
      }
    },
    async list(page, pageSize) {
      const [users, total] = await database.$transaction([
        database.user.findMany({
          skip: (page - 1) * pageSize, take: pageSize,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: { id: true, name: true, email: true, role: true, status: true, createdAt: true },
        }),
        database.user.count(),
      ]);
      return { users, total };
    },
  };
}
