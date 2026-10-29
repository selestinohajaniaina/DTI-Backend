import type { Request, Response } from 'express';
import { env } from '../config/env';
import { generateIdeasFromPhoto } from '../services/ideas.service';
import { asyncHandler } from '../utils/async-handler';
import { AppError } from '../utils/errors';
import { sendSuccess } from '../utils/response';

export const generateIdeas = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const file = req.file;
  if (!file) {
    throw new AppError(400, 'VALIDATION_ERROR', 'An image file is required (field "image")');
  }
  const ownership = req.ownership;
  if (!ownership) {
    // Unreachable: attachOwnership runs earlier on this route.
    throw new AppError(500, 'INTERNAL_ERROR', 'Ownership context is missing');
  }
  // A multi-minute generation: abort in-flight Meta requests (and their
  // retries) when the client disconnects. `close` on the response fires for
  // premature disconnects; post-completion aborts are harmless no-ops.
  const abort = new AbortController();
  const onClose = (): void => {
    abort.abort();
  };
  res.on('close', onClose);
  try {
    const result = await generateIdeasFromPhoto(file.buffer, {
      apiKey: env.modelApiKey,
      metaApiBase: env.metaApiBase,
      uploadDir: env.uploadDir,
      ideasCount: env.generatedIdeasCount,
      ownership,
      signal: abort.signal,
    });
    sendSuccess(res, result, 200);
  } catch (error) {
    // Nobody is listening anymore; skip the error response entirely.
    if (error instanceof AppError && error.code === 'AI_CANCELLED') {
      return;
    }
    throw error;
  } finally {
    res.off('close', onClose);
  }
});
