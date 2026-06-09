import Fastify from 'fastify';
import cors from '@fastify/cors';
import prismaPlugin from './plugins/prisma.js';
import authPlugin from './plugins/auth.js';
import authRoutes from './routes/auth.js';
import projectRoutes from './routes/projects.js';
import writtenContentRoutes from './routes/written-content.js';
import designRoutes from './routes/design.js';
import { errorHandler } from './middleware/error-handler.js';

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      transport:
        process.env.NODE_ENV === 'development'
          ? { target: 'pino-pretty', options: { colorize: true } }
          : undefined,
    },
  });

  // CORS
  await app.register(cors, {
    origin: process.env.FRONTEND_URL ?? 'http://localhost:4200',
    credentials: true,
  });

  // Plugins
  await app.register(prismaPlugin);
  await app.register(authPlugin);

  // Error handler
  app.setErrorHandler(errorHandler);

  // Health check
  app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  // Routes
  await app.register(authRoutes, { prefix: '/auth' });
  await app.register(projectRoutes, { prefix: '/projects' });
  await app.register(writtenContentRoutes, { prefix: '/projects' });
  await app.register(designRoutes, { prefix: '/projects' });

  return app;
}
