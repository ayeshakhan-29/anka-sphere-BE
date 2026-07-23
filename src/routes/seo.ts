import { FastifyPluginAsync } from 'fastify';

const seoRoutes: FastifyPluginAsync = async (app) => {
  const auth = { preHandler: [app.authenticate] };

  // ── Backlinks ──────────────────────────────────────────────────────────────

  app.get<{ Params: { id: string } }>('/:id/seo/backlinks', auth, async (request) => {
    return app.prisma.backlink.findMany({
      where: { projectId: request.params.id },
      orderBy: { createdAt: 'desc' },
    });
  });

  app.post<{ Params: { id: string }; Body: Record<string, any> }>('/:id/seo/backlinks', auth, async (request, reply) => {
    const body = (request.body as any) || {};
    const link = await app.prisma.backlink.create({
      data: {
        projectId: request.params.id,
        sourceDomain: body.sourceDomain || 'example.com',
        targetPage: body.targetPage || '/services',
        anchorText: body.anchorText || 'Top Marketing Agency',
        daScore: body.daScore ?? 45,
        status: body.status || 'LIVE',
        acquiredAt: body.acquiredAt ? new Date(body.acquiredAt) : new Date(),
      },
    });
    return reply.code(201).send(link);
  });

  app.delete<{ Params: { id: string; linkId: string } }>('/:id/seo/backlinks/:linkId', auth, async (request, reply) => {
    await app.prisma.backlink.delete({ where: { id: request.params.linkId } });
    return reply.code(204).send();
  });

  // ── Rank Tracker Logs ──────────────────────────────────────────────────────

  app.get<{ Params: { id: string } }>('/:id/seo/rank-tracker', auth, async (request) => {
    return app.prisma.keywordRankLog.findMany({
      where: { projectId: request.params.id },
      orderBy: { checkedAt: 'desc' },
    });
  });

  app.post<{ Params: { id: string }; Body: Record<string, any> }>('/:id/seo/rank-tracker', auth, async (request, reply) => {
    const body = (request.body as any) || {};
    const log = await app.prisma.keywordRankLog.create({
      data: {
        projectId: request.params.id,
        keyword: body.keyword || 'Digital Marketing',
        position: body.position ?? 3,
        previousPos: body.previousPos ?? 5,
        clusterName: body.clusterName || 'Core Services',
      },
    });
    return reply.code(201).send(log);
  });

};

export default seoRoutes;
