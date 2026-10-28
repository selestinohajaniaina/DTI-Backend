import { z } from 'zod';

export const aiTestSchema = z.object({
  prompt: z.string().trim().min(1, 'Prompt is required').max(4000, 'Prompt is too long'),
});
export type AiTestInput = z.infer<typeof aiTestSchema>;
