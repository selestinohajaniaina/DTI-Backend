import { z } from 'zod';

const nameSchema = z
  .string()
  .trim()
  .min(1, 'Name is required')
  .max(100, 'Name must be at most 100 characters');

// Trimmed before the format check (z.email() alone rejects padded input);
// lowercasing happens in normalizeEmail() so the stored value is canonical.
const emailSchema = z
  .string()
  .trim()
  .max(255, 'Email must be at most 255 characters')
  .pipe(z.email('Invalid email address'));

const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters');

export const registerSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema,
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required').max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;
