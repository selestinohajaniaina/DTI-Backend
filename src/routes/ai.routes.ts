import { Router } from 'express';
import { testAi } from '../controllers/ai.controller';
import { requireAuth } from '../middlewares/auth.middleware';
import { validateBody } from '../middlewares/validate.middleware';
import { aiTestSchema } from '../validators/ai.validator';

export const aiRouter: Router = Router();

// Protected like every non-public route: Postman callers register/login first
// (see README). No development-only bypass, so production stays safe.
aiRouter.post('/test', requireAuth, validateBody(aiTestSchema), testAi);
