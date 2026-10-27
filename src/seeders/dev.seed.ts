import { User } from '../models/user.model';
import { hashPassword } from '../utils/password';

export const DEV_SEED_EMAIL = 'demo@dti.local';

/** Idempotent development seed: creates a demo user unless one already exists. */
export async function seedDevelopment(): Promise<{ created: boolean }> {
  const existing = await User.findOne({ where: { email: DEV_SEED_EMAIL } });
  if (existing) {
    return { created: false };
  }
  await User.create({
    name: 'Demo User',
    email: DEV_SEED_EMAIL,
    passwordHash: await hashPassword('ChangeMe123!'),
  });
  return { created: true };
}
