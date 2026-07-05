import Fastify from 'fastify';
import cors from '@fastify/cors';
import prismaPlugin from './plugins/prisma.js';
import authPlugin from './plugins/auth.js';
import emailPlugin from './plugins/email.js';
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
import reportRoutes from './routes/reports.js';
import aiRoutes from './routes/ai.js';
import { startReportScheduler } from './services/report-scheduler.js';

import { errorHandler } from './middleware/error-handler.js';

export async function buildApp() {
  const app = Fastify({
    // AI-generated images are saved as ~2 MB base64 data URIs; default 1 MB would 413 them
    bodyLimit: 25 * 1024 * 1024,
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      transport:
        process.env.NODE_ENV === 'development'
          ? { target: 'pino-pretty', options: { colorize: true } }
          : undefined,
    },
  });

  // CORS - Allow multiple origins
  const allowedOrigins = [
    'http://localhost:4200',
    'https://anka-sphere-production.up.railway.app',
    process.env.FRONTEND_URL,
  ].filter(Boolean);

  await app.register(cors, {
    origin: (origin, cb) => {
      // Allow requests with no origin (like mobile apps, Postman, or same-origin)
      if (!origin || allowedOrigins.includes(origin)) {
        cb(null, true);
      } else {
        cb(new Error('Not allowed by CORS'), false);
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // Plugins
  await app.register(prismaPlugin);
  await app.register(authPlugin);
  await app.register(emailPlugin);

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
  await app.register(reportRoutes,      { prefix: '/projects' });
  await app.register(aiRoutes,          { prefix: '/projects' });

  startReportScheduler(app);

  return app;
}
