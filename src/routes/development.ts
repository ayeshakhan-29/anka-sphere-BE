import { FastifyPluginAsync } from 'fastify';
import {
  upsertDevelopmentBriefSchema,
  devTaskSchema,
  UpsertDevelopmentBriefBody,
  DevTaskBody,
} from '../schemas/development.js';

const developmentRoutes: FastifyPluginAsync = async (app) => {
  const auth = { preHandler: [app.authenticate] };

  // ── Development brief ─────────────────────────────────────────────────────

  // GET /projects/:id/development
  app.get<{ Params: { id: string } }>('/:id/development', auth, async (request, reply) => {
    const dev = await app.prisma.development.findUnique({
      where: { projectId: request.params.id },
      include: { tasks: { orderBy: [{ status: 'asc' }, { sortOrder: 'asc' }] } },
    });
    if (!dev) return reply.code(404).send({ error: 'Development workspace not found' });
    return dev;
  });

  // PUT /projects/:id/development
  app.put<{ Params: { id: string }; Body: UpsertDevelopmentBriefBody }>(
    '/:id/development',
    auth,
    async (request) => {
      const body = upsertDevelopmentBriefSchema.parse(request.body);
      return app.prisma.development.upsert({
        where:  { projectId: request.params.id },
        update: body,
        create: { ...body, projectId: request.params.id },
        include: { tasks: { orderBy: [{ status: 'asc' }, { sortOrder: 'asc' }] } },
      });
    },
  );

  // POST /projects/:id/development/complete  (Soft Gate)
  app.post<{ Params: { id: string } }>('/:id/development/complete', auth, async (request, reply) => {
    const dev = await app.prisma.development.findUnique({
      where: { projectId: request.params.id },
      include: { tasks: true },
    });

    if (!dev?.techStack && !dev?.repoUrl) {
      return reply.code(422).send({ error: 'Development brief is required before passing the Soft Gate.' });
    }

    const doneTasks  = dev.tasks.filter((t: { status: string }) => t.status === 'DONE').length;
    const totalTasks = dev.tasks.length;

    const warnings: string[] = [];
    if (totalTasks > 0 && doneTasks < totalTasks) {
      warnings.push(`${totalTasks - doneTasks} dev task(s) still incomplete.`);
    }

    await app.prisma.$transaction([
      app.prisma.development.update({
        where: { projectId: request.params.id },
        data:  { completedAt: new Date() },
      }),
      app.prisma.pipelineEntry.update({
        where: { projectId_stage: { projectId: request.params.id, stage: 'DEVELOPMENT' } },
        data:  { status: 'APPROVED', approvedAt: new Date() },
      }),
      app.prisma.pipelineEntry.update({
        where: { projectId_stage: { projectId: request.params.id, stage: 'MARKETING' } },
        data:  { status: 'IN_PROGRESS', startedAt: new Date() },
      }),
      app.prisma.project.update({
        where: { id: request.params.id },
        data:  { currentStage: 'MARKETING' },
      }),
    ]);

    return { message: 'Development approved. Marketing stage unlocked.', warnings };
  });

  // ── Dev Tasks ─────────────────────────────────────────────────────────────

  // POST /projects/:id/development/tasks
  app.post<{ Params: { id: string }; Body: DevTaskBody }>(
    '/:id/development/tasks',
    auth,
    async (request) => {
      const body = devTaskSchema.parse(request.body);
      const dev = await app.prisma.development.upsert({
        where:  { projectId: request.params.id },
        update: {},
        create: { projectId: request.params.id },
      });
      return app.prisma.devTask.create({
        data: { ...body, developmentId: dev.id },
      });
    },
  );

  // PATCH /projects/:id/development/tasks/:taskId
  app.patch<{ Params: { id: string; taskId: string }; Body: Partial<DevTaskBody> }>(
    '/:id/development/tasks/:taskId',
    auth,
    async (request) => {
      const body = devTaskSchema.partial().parse(request.body);
      return app.prisma.devTask.update({
        where: { id: request.params.taskId },
        data:  body,
      });
    },
  );

  // DELETE /projects/:id/development/tasks/:taskId
  app.delete<{ Params: { id: string; taskId: string } }>(
    '/:id/development/tasks/:taskId',
    auth,
    async (request, reply) => {
      await app.prisma.devTask.delete({ where: { id: request.params.taskId } });
      return reply.code(204).send();
    },
  );
};

export default developmentRoutes;
