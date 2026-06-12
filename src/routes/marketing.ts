import { FastifyPluginAsync } from 'fastify';
import {
  upsertMarketingSchema,
  marketingTaskSchema,
  UpsertMarketingBody,
  MarketingTaskBody,
} from '../schemas/marketing.js';

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
};

export default marketingRoutes;
