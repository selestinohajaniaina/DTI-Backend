import { z } from 'zod';

const MAX_QUERY_LENGTH = 200;
const MAX_LIMIT = 50;

export const librarySortSchema = z.enum(['newest', 'oldest', 'title', 'priceAsc', 'priceDesc']);
export type LibrarySort = z.infer<typeof librarySortSchema>;

export const libraryDifficultySchema = z.enum(['Easy', 'Medium', 'Hard']);
export type LibraryDifficulty = z.infer<typeof libraryDifficultySchema>;

const booleanString = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true')
  .optional();

/**
 * GET /api/ai/ideas query. All values arrive as strings; page/limit are
 * coerced. Empty search text is treated as no search.
 */
export const listIdeasQuerySchema = z.object({
  q: z.string().trim().max(MAX_QUERY_LENGTH).optional(),
  sourceObjectId: z.string().uuid().optional(),
  difficulty: libraryDifficultySchema.optional(),
  hasPrice: booleanString,
  sort: librarySortSchema.default('newest'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(12),
});
export type ListIdeasQuery = z.infer<typeof listIdeasQuerySchema>;
