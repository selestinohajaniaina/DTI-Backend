import { User } from '../models/user.model';
import type { PublicUser } from '../types/auth';
import type { LoginInput, RegisterInput } from '../validators/auth.validator';
import { AppError } from '../utils/errors';
import { signAccessToken } from '../utils/jwt';
import { hashPassword, verifyPassword } from '../utils/password';

export interface AuthResult {
  user: PublicUser;
  token: string;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export async function register(input: RegisterInput): Promise<AuthResult> {
  const email = normalizeEmail(input.email);
  const existing = await User.findOne({ where: { email } });
  if (existing) {
    throw new AppError(409, 'EMAIL_TAKEN', 'Email address is already registered');
  }
  const passwordHash = await hashPassword(input.password);
  const user = await User.create({ name: input.name, email, passwordHash });
  return { user: toPublicUser(user), token: signAccessToken({ sub: user.id, email: user.email }) };
}

export async function login(input: LoginInput): Promise<AuthResult> {
  const email = normalizeEmail(input.email);
  const user = await User.findOne({ where: { email } });
  // Identical response for unknown emails and wrong passwords so callers
  // cannot enumerate registered accounts.
  if (!user) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  }
  const ok = await verifyPassword(input.password, user.passwordHash);
  if (!ok) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  }
  return { user: toPublicUser(user), token: signAccessToken({ sub: user.id, email: user.email }) };
}

export async function getProfile(userId: string): Promise<PublicUser> {
  const user = await User.findByPk(userId);
  if (!user) {
    throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
  }
  return toPublicUser(user);
}
