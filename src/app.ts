import Fastify from 'fastify';
import cors from '@fastify/cors';
import prismaPlugin from './plugins/prisma.js';
import authPlugin from './plugins/auth.js';
import authRoutes from './routes/auth.js';
import projectRoutes from './routes/projects.js';
import writtenContentRoutes from './routes/written-content.js';
import designRoutes from './routes/design.js';
import developmentRoutes from './routes/development.js';
import developmentWpConnectionsRoutes from './routes/development-wp-connections.js';
import developmentDeploymentRoutes from './routes/deployment.js';
import wpPluginsThemesRoutes from './routes/wp-plugins-themes.js';
import marketingRoutes from './routes/marketing.js';
import maintenanceRoutes from './routes/maintenance.js';

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
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
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
  await app.register(developmentRoutes, { prefix: '/projects' });
  await app.register(developmentWpConnectionsRoutes, { prefix: '/projects' });
  await app.register(developmentDeploymentRoutes, { prefix: '/projects' });
  await app.register(wpPluginsThemesRoutes, { prefix: '/projects' });
  await app.register(marketingRoutes,   { prefix: '/projects' });
  await app.register(maintenanceRoutes, { prefix: '/maintenance' });

  return app;
}
