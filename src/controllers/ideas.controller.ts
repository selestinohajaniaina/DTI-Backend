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
  const result = await generateIdeasFromPhoto(file.buffer, {
    apiKey: env.modelApiKey,
    metaApiBase: env.metaApiBase,
    uploadDir: env.uploadDir,
  });
  sendSuccess(res, result, 200);
});
