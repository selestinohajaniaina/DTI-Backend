import { Router } from 'express';
import { authRouter } from './auth.routes';
import { healthRouter } from './health.routes';

export const apiRouter: Router = Router();

apiRouter.use('/health', healthRouter);
apiRouter.use('/auth', authRouter);
