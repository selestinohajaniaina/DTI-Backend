import type { Request, Response } from 'express';
import { env } from '../config/env';
import { runAiTest } from '../services/ai.service';
import type { AiTestInput } from '../validators/ai.validator';
import { asyncHandler } from '../utils/async-handler';
import { AppError } from '../utils/errors';
import { sendSuccess } from '../utils/response';

export const testAi = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const input = req.body as AiTestInput;
  const abort = new AbortController();
  const onClose = (): void => {
    abort.abort();
  };
  res.on('close', onClose);
  try {
    const result = await runAiTest(input.prompt, env.modelApiKey, env.metaApiBase, abort.signal);
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
