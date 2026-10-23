import argon2 from 'argon2';
import { AccountConflictError, type AccountRepository, type CreateAccountData } from '../repositories/accounts';
import type { InternalUserInput, PatientRegistration } from '../validators/accounts';
import { HttpError } from '../utils/http-error';

export function createAccountService(repository: AccountRepository) {
  async function create(data: Omit<CreateAccountData, 'passwordHash'>, password: string) {
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    try {
      const account = await repository.create({ ...data, passwordHash });
      return { id: account.id, name: account.name, role: account.role };
    } catch (error) {
      if (error instanceof AccountConflictError) throw new HttpError(409, 'E-mail ou inscrição profissional já utilizados.');
      throw error;
    }
  }
  return {
    registerPatient(input: PatientRegistration) {
      return create({
        name: input.name, email: input.email, role: 'PATIENT',
        patientProfile: {
          ...(input.phone ? { phone: input.phone } : {}),
          ...(input.birthDate ? { birthDate: new Date(`${input.birthDate}T00:00:00.000Z`) } : {}),
        },
      }, input.password);
    },
    createInternal(input: InternalUserInput) {
      return create({
        name: input.name, email: input.email, role: input.role,
        ...(input.role === 'DENTIST' ? { dentistProfile: {
          croNumber: input.croNumber, croState: input.croState,
          ...(input.specialty ? { specialty: input.specialty } : {}),
        } } : {}),
      }, input.password);
    },
    async list(page: number, pageSize: number) {
      const result = await repository.list(page, pageSize);
      return {
        users: result.users.map(({ id, name, email, role, status, createdAt }) => ({ id, name, email, role, status, createdAt })),
        total: result.total, page, pageSize,
      };
    },
  };
}
