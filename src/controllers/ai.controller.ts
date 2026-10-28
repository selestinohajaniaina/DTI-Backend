import type { Request, Response } from 'express';
import { env } from '../config/env';
import { runAiTest } from '../services/ai.service';
import type { AiTestInput } from '../validators/ai.validator';
import { asyncHandler } from '../utils/async-handler';
import { sendSuccess } from '../utils/response';

export const testAi = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const input = req.body as AiTestInput;
  const result = await runAiTest(input.prompt, env.modelApiKey, env.metaApiBase);
  sendSuccess(res, result, 200);
});
