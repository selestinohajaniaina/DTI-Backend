import type { Request, Response } from 'express';
import { env } from '../config/env';
import { runAiTest } from '../services/ai.service';
import { MetaApiError } from '../services/meta.client';
import type { MetaUpstreamDebug } from '../services/meta.client';
import type { AiTestInput } from '../validators/ai.validator';
import { asyncHandler } from '../utils/async-handler';
import { AppError } from '../utils/errors';
import { sendSuccess } from '../utils/response';

/**
 * Debug error shape, serialized ONLY by POST /api/ai/test. Every other route
 * keeps the generic envelope via the central error middleware.
 */
interface TestUpstreamErrorBody {
  success: false;
  error: { code: string; message: string };
  debug: MetaUpstreamDebug;
}

function sendTestUpstreamError(res: Response, error: MetaApiError): void {
  const body: TestUpstreamErrorBody = {
    success: false,
    error: { code: error.code, message: error.message },
    debug: error.debug,
  };
  res.status(error.statusCode).json(body);
}

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
    // Temporary debugging aid, scoped to this route only: expose the
    // sanitized upstream diagnostics. All other errors keep generic handling.
    if (error instanceof MetaApiError) {
      sendTestUpstreamError(res, error);
      return;
    }
    throw error;
  } finally {
    res.off('close', onClose);
  }
});
