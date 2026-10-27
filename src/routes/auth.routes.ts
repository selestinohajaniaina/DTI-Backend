import { Router } from 'express';
import { getMe, loginUser, registerUser } from '../controllers/auth.controller';
import { requireAuth } from '../middlewares/auth.middleware';
import { validateBody } from '../middlewares/validate.middleware';
import { loginSchema, registerSchema } from '../validators/auth.validator';

export const authRouter: Router = Router();

authRouter.post('/register', validateBody(registerSchema), registerUser);
authRouter.post('/login', validateBody(loginSchema), loginUser);
authRouter.get('/me', requireAuth, getMe);
