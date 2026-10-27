import type { Request, Response } from 'express';
import { getProfile, login, register } from '../services/auth.service';
import type { LoginInput, RegisterInput } from '../validators/auth.validator';
import { asyncHandler } from '../utils/async-handler';
import { AppError } from '../utils/errors';
import { sendSuccess } from '../utils/response';

export const registerUser = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const result = await register(req.body as RegisterInput);
  sendSuccess(res, result, 201);
});

export const loginUser = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const result = await login(req.body as LoginInput);
  sendSuccess(res, result, 200);
});

export const getMe = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  // requireAuth always sets req.user; the guard protects against a miswired route.
  if (!req.user) {
    throw new AppError(401, 'MISSING_TOKEN', 'Authentication required');
  }
  const user = await getProfile(req.user.id);
  sendSuccess(res, { user }, 200);
});
