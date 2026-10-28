import { Router } from 'express';
import { testAi } from '../controllers/ai.controller';
import { generateIdeas } from '../controllers/ideas.controller';
import { requireAuth } from '../middlewares/auth.middleware';
import { uploadImage } from '../middlewares/upload.middleware';
import { validateBody } from '../middlewares/validate.middleware';
import { aiTestSchema } from '../validators/ai.validator';

export const aiRouter: Router = Router();

// Protected like every non-public route: Postman callers register/login first
// (see README). No development-only bypass, so production stays safe.
aiRouter.post('/test', requireAuth, validateBody(aiTestSchema), testAi);
// Prototype flow: public so the anonymous upload-to-ideas demo works without
// a login UI. Revisit (auth + rate limiting) before any public exposure.
aiRouter.post('/generate-ideas', uploadImage, generateIdeas);
