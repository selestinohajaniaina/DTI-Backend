import type { Request, Response } from 'express';
import { toValidationError } from '../middlewares/validate.middleware';
import { listIdeas, listSourceObjects } from '../services/library.service';
import { asyncHandler } from '../utils/async-handler';
import { sendSuccess } from '../utils/response';
import { listIdeasQuerySchema } from '../validators/library.validator';

/**
 * Query params are validated here instead of validateBody: Express exposes
 * req.query through a getter, so parsed values cannot replace it in place.
 */
function parseListQuery(req: Request): ReturnType<typeof listIdeasQuerySchema.parse> {
  const result = listIdeasQuerySchema.safeParse(req.query);
  if (!result.success) {
    throw toValidationError(result.error, 'Invalid query parameters');
  }
  return result.data;
}

export const getIdeas = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const query = parseListQuery(req);
  const ownership = req.ownership;
  sendSuccess(res, await listIdeas(query, ownership), 200);
});

export const getSourceObjects = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const ownership = req.ownership;
  if (!ownership) {
    sendSuccess(res, { items: [] }, 200);
    return;
  }
  sendSuccess(res, { items: await listSourceObjects(ownership) }, 200);
});
