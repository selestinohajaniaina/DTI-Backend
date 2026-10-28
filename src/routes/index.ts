import { Router } from 'express';
import { aiRouter } from './ai.routes';
import { authRouter } from './auth.routes';
import { healthRouter } from './health.routes';

export const apiRouter: Router = Router();

apiRouter.use('/health', healthRouter);
apiRouter.use('/auth', authRouter);
apiRouter.use('/ai', aiRouter);
