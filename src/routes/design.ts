import { FastifyPluginAsync } from 'fastify';
import {
  upsertDesignBriefSchema,
  designTaskSchema,
  designAssetSchema,
  UpsertDesignBriefBody,
  DesignTaskBody,
  DesignAssetBody,
} from '../schemas/design.js';
import { notifyGateHandoff } from '../services/handoff.js';
import { seedDevTasks } from '../services/task-seeder.js';
import { uploadToS3 } from '../services/s3.js';

const designRoutes: FastifyPluginAsync = async (app) => {
  const auth = { preHandler: [app.authenticate] };

  // ── Design brief ─────────────────────────────────────────────────────────

  // GET /projects/:id/design
  app.get<{ Params: { id: string } }>('/:id/design', auth, async (request, reply) => {
    const design = await app.prisma.design.findUnique({
      where: { projectId: request.params.id },
      include: {
        tasks:  { orderBy: [{ status: 'asc' }, { sortOrder: 'asc' }] },
        assets: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!design) return reply.code(404).send({ error: 'Design workspace not found' });
    return design;
  });

  // PUT /projects/:id/design
  app.put<{ Params: { id: string }; Body: UpsertDesignBriefBody }>(
    '/:id/design',
    auth,
    async (request) => {
      const body = upsertDesignBriefSchema.parse(request.body);
      return app.prisma.design.upsert({
        where: { projectId: request.params.id },
        update: body,
        create: { ...body, projectId: request.params.id },
        include: {
          tasks:  { orderBy: [{ status: 'asc' }, { sortOrder: 'asc' }] },
          assets: { orderBy: { createdAt: 'desc' } },
        },
      });
    },
  );

  // POST /projects/:id/design/complete  (Soft Gate)
  app.post<{ Params: { id: string } }>('/:id/design/complete', auth, async (request, reply) => {
    const design = await app.prisma.design.findUnique({
      where: { projectId: request.params.id },
      include: { tasks: true },
    });

    const doneTasks = (design?.tasks ?? []).filter((t: { status: string }) => t.status === 'DONE').length;
    const totalTasks = (design?.tasks ?? []).length;

    // Soft gate: collect warnings but always allow progression
    const warnings: string[] = [];
    if (!design?.brief) {
      warnings.push('Design brief has not been filled in yet.');
    }
    if (totalTasks > 0 && doneTasks < totalTasks) {
      warnings.push(`${totalTasks - doneTasks} design task(s) still incomplete.`);
    }

    await app.prisma.$transaction([
      app.prisma.design.upsert({
        where: { projectId: request.params.id },
        update: { completedAt: new Date() },
        create: { projectId: request.params.id, completedAt: new Date() },
      }),
      app.prisma.pipelineEntry.update({
        where: { projectId_stage: { projectId: request.params.id, stage: 'DESIGN' } },
        data: { status: 'APPROVED', approvedAt: new Date() },
      }),
      app.prisma.pipelineEntry.update({
        where: { projectId_stage: { projectId: request.params.id, stage: 'DEVELOPMENT' } },
        data: { status: 'IN_PROGRESS', startedAt: new Date() },
      }),
      app.prisma.project.update({
        where: { id: request.params.id },
        data: { currentStage: 'DEVELOPMENT' },
      }),
    ]);

    notifyGateHandoff(app, request.params.id, 'DESIGN', 'DEVELOPMENT');
    seedDevTasks(app, request.params.id);
    return { message: 'Design approved. Development stage is now unlocked.', warnings };
  });

  // ── Design Tasks (Kanban) ─────────────────────────────────────────────────

  // POST /projects/:id/design/tasks
  app.post<{ Params: { id: string }; Body: DesignTaskBody }>(
    '/:id/design/tasks',
    auth,
    async (request, reply) => {
      const body = designTaskSchema.parse(request.body);
      const design = await app.prisma.design.upsert({
        where: { projectId: request.params.id },
        update: {},
        create: { projectId: request.params.id },
      });
      const task = await app.prisma.designTask.create({
        data: {
          ...body,
          dueDate:  body.dueDate  ? new Date(body.dueDate) : undefined,
          designId: design.id,
        },
      });
      return reply.code(201).send(task);
    },
  );

  // PATCH /projects/:id/design/tasks/:taskId
  app.patch<{ Params: { id: string; taskId: string }; Body: DesignTaskBody }>(
    '/:id/design/tasks/:taskId',
    auth,
    async (request) => {
      const body = designTaskSchema.partial().parse(request.body);
      return app.prisma.designTask.update({
        where: { id: request.params.taskId },
        data: { ...body, dueDate: body.dueDate ? new Date(body.dueDate) : undefined },
      });
    },
  );

  // DELETE /projects/:id/design/tasks/:taskId
  app.delete<{ Params: { id: string; taskId: string } }>(
    '/:id/design/tasks/:taskId',
    auth,
    async (_, reply) => {
      await app.prisma.designTask.delete({ where: { id: _.params.taskId } });
      return reply.code(204).send();
    },
  );

  // ── Design Assets ─────────────────────────────────────────────────────────

  // POST /projects/:id/design/assets
  app.post<{ Params: { id: string }; Body: DesignAssetBody }>(
    '/:id/design/assets',
    auth,
    async (request, reply) => {
      const body = designAssetSchema.parse(request.body);
      const design = await app.prisma.design.upsert({
        where: { projectId: request.params.id },
        update: {},
        create: { projectId: request.params.id },
      });

      let url = body.url;
      let thumbnailUrl = body.thumbnailUrl;
      if (url.startsWith('data:')) {
        url = await uploadToS3(url, 'design-asset');
      }
      if (thumbnailUrl && thumbnailUrl.startsWith('data:')) {
        thumbnailUrl = await uploadToS3(thumbnailUrl, 'design-thumbnail');
      }

      const asset = await app.prisma.designAsset.create({
        data: {
          ...body,
          url,
          thumbnailUrl,
          designId: design.id,
        },
      });
      return reply.code(201).send(asset);
    },
  );

  // PATCH /projects/:id/design/assets/:assetId
  app.patch<{ Params: { id: string; assetId: string }; Body: DesignAssetBody }>(
    '/:id/design/assets/:assetId',
    auth,
    async (request) => {
      const body = designAssetSchema.partial().parse(request.body);
      return app.prisma.designAsset.update({
        where: { id: request.params.assetId },
        data: body,
      });
    },
  );

  // POST /projects/:id/design/assets/:assetId/approve
  app.post<{ Params: { id: string; assetId: string } }>(
    '/:id/design/assets/:assetId/approve',
    auth,
    async (request) => {
      return app.prisma.designAsset.update({
        where: { id: request.params.assetId },
        data: { approvedAt: new Date() },
      });
    },
  );

  // DELETE /projects/:id/design/assets/:assetId
  app.delete<{ Params: { id: string; assetId: string } }>(
    '/:id/design/assets/:assetId',
    auth,
    async (_, reply) => {
      await app.prisma.designAsset.delete({ where: { id: _.params.assetId } });
      return reply.code(204).send();
    },
  );
};

export default designRoutes;
