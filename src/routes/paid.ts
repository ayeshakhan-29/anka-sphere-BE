import { FastifyPluginAsync } from 'fastify';
import { AdNetwork } from '@prisma/client';
import { metricsQuerySchema } from '../schemas/analytics.js';
import { upsertAdAccountLinkSchema, UpsertAdAccountLinkBody } from '../schemas/paid.js';
import { fetchGoogleAdsCampaigns } from '../services/integrations/google-ads.js';
import { fetchMetaAdsCampaigns } from '../services/integrations/meta.js';
import { cachedMetrics } from '../services/integrations/metric-cache.js';

/**
 * Ad account links + live campaign data (Google Ads / Meta Ads), cached in
 * MetricSnapshot. 409 = no ad account linked; 503 = provider not connected.
 */
const paidRoutes: FastifyPluginAsync = async (app) => {
  const auth = { preHandler: [app.authenticate] };

  const requireProject = async (id: string) =>
    app.prisma.project.findUnique({ where: { id }, select: { id: true } });

  // ── AdAccountLink CRUD ──────────────────────────────────────────────────────

  app.get<{ Params: { id: string } }>('/:id/paid/ad-accounts', auth, async (request, reply) => {
    if (!(await requireProject(request.params.id))) return reply.code(404).send({ error: 'Project not found' });
    const links = await app.prisma.adAccountLink.findMany({
      where: { projectId: request.params.id },
      orderBy: { network: 'asc' },
    });
    return { links };
  });

  app.put<{ Params: { id: string }; Body: UpsertAdAccountLinkBody }>(
    '/:id/paid/ad-accounts',
    auth,
    async (request, reply) => {
      if (!(await requireProject(request.params.id))) return reply.code(404).send({ error: 'Project not found' });
      const body = upsertAdAccountLinkSchema.parse(request.body);

      const link = await app.prisma.adAccountLink.upsert({
        where: { projectId_network: { projectId: request.params.id, network: body.network } },
        update: {
          externalAccountId: body.externalAccountId,
          externalAccountName: body.externalAccountName ?? null,
          externalCampaignIds: body.externalCampaignIds ?? undefined,
        },
        create: {
          projectId: request.params.id,
          network: body.network,
          externalAccountId: body.externalAccountId,
          externalAccountName: body.externalAccountName ?? null,
          externalCampaignIds: body.externalCampaignIds ?? undefined,
        },
      });
      return { link };
    },
  );

  app.delete<{ Params: { id: string; network: string } }>(
    '/:id/paid/ad-accounts/:network',
    auth,
    async (request, reply) => {
      const network = request.params.network.toUpperCase();
      if (network !== 'GOOGLE' && network !== 'META') {
        return reply.code(400).send({ error: 'network must be GOOGLE or META' });
      }
      await app.prisma.adAccountLink.delete({
        where: { projectId_network: { projectId: request.params.id, network: network as AdNetwork } },
      });
      return { deleted: true };
    },
  );

  // ── Live campaign data ──────────────────────────────────────────────────────

  const campaignRoute = (path: string, network: AdNetwork, source: 'GOOGLE_ADS' | 'META_ADS') => {
    app.get<{ Params: { id: string }; Querystring: Record<string, string> }>(path, auth, async (request, reply) => {
      const query = metricsQuerySchema.parse(request.query);
      if (!(await requireProject(request.params.id))) return reply.code(404).send({ error: 'Project not found' });

      const link = await app.prisma.adAccountLink.findUnique({
        where: { projectId_network: { projectId: request.params.id, network } },
      });
      if (!link || !link.externalAccountId) {
        return reply.code(400).send({
          error: 'MISSING_CONFIG',
          message: `${network === 'GOOGLE' ? 'Google Ads Customer Account ID' : 'Meta Ads Account ID'} is not configured. Please add it in the form above.`,
        });
      }

      try {
        return await cachedMetrics(app, request.params.id, source, `${query.range}d`, query.refresh, () =>
          network === 'GOOGLE'
            ? fetchGoogleAdsCampaigns(app, link.externalAccountId, query.range, request.params.id)
            : fetchMetaAdsCampaigns(app, link.externalAccountId, query.range, request.params.id),
        );
      } catch (err: any) {
        return reply.code(400).send({
          error: 'ADS_FETCH_ERROR',
          message: err.message || `Failed to fetch ${network} campaigns.`,
        });
      }
    });
  };

  campaignRoute('/:id/paid/google-ads', 'GOOGLE', 'GOOGLE_ADS');
  campaignRoute('/:id/paid/meta-ads', 'META', 'META_ADS');

  // ── Ad Creatives ─────────────────────────────────────────────────────────

  app.get<{ Params: { id: string } }>('/:id/paid/ad-creatives', auth, async (request) => {
    return app.prisma.adCreative.findMany({
      where: { projectId: request.params.id },
      orderBy: { createdAt: 'desc' },
    });
  });

  app.post<{ Params: { id: string }; Body: Record<string, any> }>('/:id/paid/ad-creatives', auth, async (request, reply) => {
    const body = (request.body as any) || {};
    const creative = await app.prisma.adCreative.create({
      data: {
        projectId: request.params.id,
        title: body.title || 'Untitled Ad Creative',
        format: body.format || 'STATIC_IMAGE',
        network: body.network || 'META',
        mediaUrl: body.mediaUrl || null,
        headline: body.headline || null,
        bodyCopy: body.bodyCopy || null,
        targetAdSet: body.targetAdSet || 'All Audiences',
        status: body.status || 'DRAFT',
      },
    });
    return reply.code(201).send(creative);
  });

  app.delete<{ Params: { id: string; creativeId: string } }>('/:id/paid/ad-creatives/:creativeId', auth, async (request, reply) => {
    await app.prisma.adCreative.delete({ where: { id: request.params.creativeId } });
    return reply.code(204).send();
  });

  // ── Conversion Events ─────────────────────────────────────────────────────

  app.get<{ Params: { id: string } }>('/:id/paid/conversion-events', auth, async (request) => {
    return app.prisma.conversionEvent.findMany({
      where: { projectId: request.params.id },
      orderBy: { createdAt: 'desc' },
    });
  });

  app.post<{ Params: { id: string }; Body: Record<string, any> }>('/:id/paid/conversion-events', auth, async (request, reply) => {
    const body = (request.body as any) || {};
    const event = await app.prisma.conversionEvent.create({
      data: {
        projectId: request.params.id,
        eventName: body.eventName || 'Lead Form Submit',
        platform: body.platform || 'GTM',
        triggerUrl: body.triggerUrl || '/thank-you',
        firingRate: body.firingRate ?? 100,
        status: body.status || 'FIRING',
        lastFiredAt: new Date(),
      },
    });
    return reply.code(201).send(event);
  });

  app.patch<{ Params: { id: string; eventId: string }; Body: Record<string, any> }>('/:id/paid/conversion-events/:eventId', auth, async (request) => {
    const body = (request.body as any) || {};
    return app.prisma.conversionEvent.update({
      where: { id: request.params.eventId },
      data: body,
    });
  });


  app.delete<{ Params: { id: string; eventId: string } }>('/:id/paid/conversion-events/:eventId', auth, async (request, reply) => {
    await app.prisma.conversionEvent.delete({ where: { id: request.params.eventId } });
    return reply.code(204).send();
  });
};

export default paidRoutes;

