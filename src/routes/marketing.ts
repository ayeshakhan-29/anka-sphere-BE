import { FastifyPluginAsync } from 'fastify';
import {
  upsertMarketingSchema,
  marketingTaskSchema,
  UpsertMarketingBody,
  MarketingTaskBody,
} from '../schemas/marketing.js';
import { notifyGateHandoff } from '../services/handoff.js';

const marketingRoutes: FastifyPluginAsync = async (app) => {
  const auth = { preHandler: [app.authenticate] };

  // GET /projects/:id/marketing
  app.get<{ Params: { id: string } }>('/:id/marketing', auth, async (request, reply) => {
    const marketing = await app.prisma.marketing.findUnique({
      where: { projectId: request.params.id },
      include: { tasks: { orderBy: [{ status: 'asc' }, { sortOrder: 'asc' }] } },
    });
    if (!marketing) return reply.code(404).send({ error: 'Marketing not found' });
    return marketing;
  });

  // PUT /projects/:id/marketing
  app.put<{ Params: { id: string }; Body: UpsertMarketingBody }>(
    '/:id/marketing',
    auth,
    async (request) => {
      const body = upsertMarketingSchema.parse(request.body);
      return app.prisma.marketing.upsert({
        where:  { projectId: request.params.id },
        update: body,
        create: { ...body, projectId: request.params.id },
        include: { tasks: { orderBy: [{ status: 'asc' }, { sortOrder: 'asc' }] } },
      });
    },
  );

  // POST /projects/:id/marketing/complete  (Soft Gate → project complete)
  app.post<{ Params: { id: string } }>('/:id/marketing/complete', auth, async (request, reply) => {
    const marketing = await app.prisma.marketing.findUnique({
      where: { projectId: request.params.id },
      include: { tasks: true },
    });

    const warnings: string[] = [];
    if (!marketing?.strategy && !marketing?.channels) {
      warnings.push('No marketing strategy or channels have been defined.');
    }
    const openTasks = marketing?.tasks.filter(t => t.status !== 'DONE').length ?? 0;
    if (openTasks > 0) {
      warnings.push(`${openTasks} task(s) are not yet marked as done.`);
    }

    await app.prisma.$transaction([
      app.prisma.marketing.upsert({
        where:  { projectId: request.params.id },
        update: { completedAt: new Date() },
        create: { projectId: request.params.id, completedAt: new Date() },
      }),
      app.prisma.pipelineEntry.update({
        where: { projectId_stage: { projectId: request.params.id, stage: 'MARKETING' } },
        data:  { status: 'APPROVED', approvedAt: new Date() },
      }),
      app.prisma.project.update({
        where: { id: request.params.id },
        data:  { status: 'COMPLETED' },
      }),
    ]);

    notifyGateHandoff(app, request.params.id, 'MARKETING', null);
    return reply.code(200).send({ message: 'Marketing stage approved. Project marked as completed.', warnings });
  });

  // ── Marketing Tasks ───────────────────────────────────────────────────────

  // POST /projects/:id/marketing/tasks
  app.post<{ Params: { id: string }; Body: MarketingTaskBody }>(
    '/:id/marketing/tasks',
    auth,
    async (request, reply) => {
      const body = marketingTaskSchema.parse(request.body);
      const marketing = await app.prisma.marketing.upsert({
        where:  { projectId: request.params.id },
        update: {},
        create: { projectId: request.params.id },
      });
      const task = await app.prisma.marketingTask.create({
        data: {
          ...body,
          dueDate:    body.dueDate ? new Date(body.dueDate) : undefined,
          marketingId: marketing.id,
        },
      });
      return reply.code(201).send(task);
    },
  );

  // PATCH /projects/:id/marketing/tasks/:taskId
  app.patch<{ Params: { id: string; taskId: string }; Body: MarketingTaskBody }>(
    '/:id/marketing/tasks/:taskId',
    auth,
    async (request) => {
      const body = marketingTaskSchema.partial().parse(request.body);
      return app.prisma.marketingTask.update({
        where: { id: request.params.taskId },
        data:  { ...body, dueDate: body.dueDate ? new Date(body.dueDate) : undefined },
      });
    },
  );

  // DELETE /projects/:id/marketing/tasks/:taskId
  app.delete<{ Params: { id: string; taskId: string } }>(
    '/:id/marketing/tasks/:taskId',
    auth,
    async (_, reply) => {
      await app.prisma.marketingTask.delete({ where: { id: _.params.taskId } });
      return reply.code(204).send();
    },
  );

  // ── Email Campaigns ────────────────────────────────────────────────────────

  app.get<{ Params: { id: string } }>('/:id/email-campaigns', auth, async (request) => {
    return app.prisma.emailCampaign.findMany({
      where: { projectId: request.params.id },
      orderBy: { createdAt: 'desc' },
    });
  });

  app.post<{ Params: { id: string }; Body: Record<string, any> }>('/:id/email-campaigns', auth, async (request, reply) => {
    const body = (request.body as any) || {};
    const campaign = await app.prisma.emailCampaign.create({
      data: {
        projectId: request.params.id,
        name: body.name || 'Untitled Campaign',
        audienceSegment: body.audienceSegment || 'All Subscribers',
        subjectLines: body.subjectLines || ['Subject Line V1', 'Subject Line V2'],
        bodyCopy: body.bodyCopy || '',
        cta: body.cta || 'Learn More',
        sendDate: body.sendDate ? new Date(body.sendDate) : new Date(),
        status: body.status || 'DRAFT',
      },
    });
    return reply.code(201).send(campaign);
  });

  app.delete<{ Params: { id: string; campaignId: string } }>('/:id/email-campaigns/:campaignId', auth, async (request, reply) => {
    await app.prisma.emailCampaign.delete({ where: { id: request.params.campaignId } });
    return reply.code(204).send();
  });

  // ── Content Repurposing ───────────────────────────────────────────────────

  app.get<{ Params: { id: string } }>('/:id/repurposing', auth, async (request) => {
    return app.prisma.contentRepurpose.findMany({
      where: { projectId: request.params.id },
      include: { sourcePage: true },
      orderBy: { createdAt: 'desc' },
    });
  });

  app.post<{ Params: { id: string }; Body: Record<string, any> }>('/:id/repurposing', auth, async (request, reply) => {
    const body = (request.body as any) || {};
    const item = await app.prisma.contentRepurpose.create({
      data: {
        projectId: request.params.id,
        sourcePageId: body.sourcePageId || null,
        targetFormat: body.targetFormat || 'CAROUSEL',
        title: body.title || 'Repurposed Content Item',
        notes: body.notes || '',
        status: body.status || 'PLANNED',
      },
    });
    return reply.code(201).send(item);
  });


  app.delete<{ Params: { id: string; itemSetId: string } }>('/:id/repurposing/:itemSetId', auth, async (request, reply) => {
    await app.prisma.contentRepurpose.delete({ where: { id: request.params.itemSetId } });
    return reply.code(204).send();
  });

  // ── Master Content Calendar ───────────────────────────────────────────────

  app.get<{ Params: { id: string } }>('/:id/master-calendar', auth, async (request) => {
    const projectId = request.params.id;

    const [writtenContent, socialPosts, emailCampaigns] = await Promise.all([
      app.prisma.writtenContent.findUnique({
        where: { projectId },
        include: { pages: true },
      }),
      app.prisma.socialPost.findMany({
        where: { projectId },
      }),
      app.prisma.emailCampaign.findMany({
        where: { projectId },
      }),
    ]);

    const events: any[] = [];

    // Blog / Page items
    if (writtenContent?.pages) {
      writtenContent.pages.forEach((page) => {
        events.push({
          id: `page-${page.id}`,
          title: page.title,
          type: 'BLOG',
          date: page.updatedAt,
          status: page.status,
          channel: 'Website',
        });
      });
    }

    // Social Posts
    socialPosts.forEach((post) => {
      events.push({
        id: `social-${post.id}`,
        title: post.caption.slice(0, 40) + '...',
        type: 'SOCIAL',
        date: post.scheduledAt || post.createdAt,
        status: post.status,
        channel: post.platform,
      });
    });

    // Email Campaigns
    emailCampaigns.forEach((email) => {
      events.push({
        id: `email-${email.id}`,
        title: email.name,
        type: 'EMAIL',
        date: email.sendDate || email.createdAt,
        status: email.status,
        channel: 'Email Newsletter',
      });
    });

    return events;
  });
};

export default marketingRoutes;

