import { FastifyPluginAsync } from 'fastify';
import { metricsQuerySchema } from '../schemas/analytics.js';
import { fetchGa4Metrics } from '../services/integrations/ga4.js';
import { fetchGscMetrics } from '../services/integrations/gsc.js';
import { cachedMetrics } from '../services/integrations/metric-cache.js';

/**
 * Live GA4 / Search Console metrics per project, cached in MetricSnapshot.
 * 409 = project-level config missing (set property/URL on the project);
 * 503 = Google not connected (from IntegrationUnavailableError).
 */
const analyticsRoutes: FastifyPluginAsync = async (app) => {
  const auth = { preHandler: [app.authenticate] };

  app.get<{ Params: { id: string }; Querystring: Record<string, string> }>(
    '/:id/analytics/ga4',
    auth,
    async (request, reply) => {
      const query = metricsQuerySchema.parse(request.query);
      const project = await app.prisma.project.findUnique({
        where: { id: request.params.id },
        select: { id: true, analyticsPropertyId: true },
      });
      if (!project) return reply.code(404).send({ error: 'Project not found' });
      if (!project.analyticsPropertyId) {
        return reply.code(409).send({ error: 'No GA4 property configured for this project.' });
      }

      return cachedMetrics(app, project.id, 'GA4', `${query.range}d`, query.refresh, () =>
        fetchGa4Metrics(app, project.analyticsPropertyId!, query.range),
      );
    },
  );

  app.get<{ Params: { id: string }; Querystring: Record<string, string> }>(
    '/:id/analytics/gsc',
    auth,
    async (request, reply) => {
      const query = metricsQuerySchema.parse(request.query);
      const project = await app.prisma.project.findUnique({
        where: { id: request.params.id },
        select: { id: true, searchConsoleUrl: true },
      });
      if (!project) return reply.code(404).send({ error: 'Project not found' });
      if (!project.searchConsoleUrl) {
        return reply.code(409).send({ error: 'No Search Console property configured for this project.' });
      }

      return cachedMetrics(app, project.id, 'GSC', `${query.range}d`, query.refresh, () =>
        fetchGscMetrics(app, project.searchConsoleUrl!, query.range),
      );
    },
  );
};

export default analyticsRoutes;
