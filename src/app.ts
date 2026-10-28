import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { env } from './config/env';
import { errorHandler } from './middlewares/error.middleware';
import { notFound } from './middlewares/not-found.middleware';
import { requestLogger } from './middlewares/request-logger.middleware';
import { apiRouter } from './routes/index';

/** Builds the Express application without binding any port (test-friendly). */
export function createApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  // Images under /uploads are meant to be embedded cross-origin (Angular dev
  // server); the default same-origin resource policy would block them.
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(
    cors({
      origin: env.frontendOrigins,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      maxAge: 600,
    }),
  );
  app.use(express.json({ limit: '100kb' }));
  app.use(requestLogger);
  // Backend-managed generated assets only (server-chosen filenames under
  // <uploadDir>/generated). No directory listing, no dotfiles.
  app.use(
    '/uploads',
    express.static(env.uploadDir, { dotfiles: 'deny', index: false, maxAge: '1d' }),
  );
  app.use('/api', apiRouter);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
