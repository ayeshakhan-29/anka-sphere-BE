import { FastifyPluginAsync } from 'fastify';
import {
  upsertDevelopmentBriefSchema,
  devTaskSchema,
  UpsertDevelopmentBriefBody,
  DevTaskBody,
} from '../schemas/development.js';
import { notifyGateHandoff } from '../services/handoff.js';
import { seedMarketingTasks } from '../services/task-seeder.js';

type MaintenanceRequestBody = {
  title?: string;
  description?: string;
  priority?: 'LOW' | 'MEDIUM' | 'HIGH';
  target?: string;
  requestedBy?: string;
};

function arrayFromJson(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}
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

    const doneTasks  = dev.tasks.filter((t: { status: string }) => t.status === 'LIVE' || t.status === 'MAINTENANCE').length;
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

    notifyGateHandoff(app, request.params.id, 'DEVELOPMENT', 'MARKETING');
    seedMarketingTasks(app, request.params.id);
    return { message: 'Development approved. Marketing stage unlocked.', warnings };
  });

  // ── Dev Tasks ─────────────────────────────────────────────────────────────

  // POST /projects/:id/development/tasks
  app.post<{ Params: { id: string }; Body: DevTaskBody }>(
    '/:id/development/tasks',
    auth,
    async (request, reply) => {
      if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body)) {
        return reply.code(400).send({ error: 'Request body must be a valid JSON object' });
      }
      const body = devTaskSchema.parse(request.body);
      const dev = await app.prisma.development.upsert({
        where:  { projectId: request.params.id },
        update: {},
        create: { projectId: request.params.id },
      });
      return app.prisma.devTask.create({
        data: { ...body, dueDate: body.dueDate ? new Date(body.dueDate) : undefined, developmentId: dev.id },
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
        data:  { ...body, dueDate: body.dueDate ? new Date(body.dueDate) : undefined },
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
  // GET /projects/:id/development/changelog
  app.get<{ Params: { id: string } }>('/:id/development/changelog', auth, async (request) => {
    const dev = await app.prisma.development.upsert({
      where: { projectId: request.params.id },
      update: {},
      create: { projectId: request.params.id },
    });
    return Array.isArray(dev.changeLog) ? dev.changeLog : [];
  });

  // POST /projects/:id/development/changelog
  app.post<{ Params: { id: string }; Body: { pageName?: string; description?: string; changedBy?: string; changedAt?: string } }>(
    '/:id/development/changelog',
    auth,
    async (request, reply) => {
      const body = request.body ?? {};
      if (!body.pageName || !body.description) {
        return reply.code(400).send({ error: 'pageName and description are required' });
      }
      const dev = await app.prisma.development.upsert({
        where: { projectId: request.params.id },
        update: {},
        create: { projectId: request.params.id },
      });
      const current = Array.isArray(dev.changeLog) ? dev.changeLog as any[] : [];
      const entry = {
        id: `cl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        projectId: request.params.id,
        pageName: body.pageName,
        description: body.description,
        changedBy: body.changedBy || request.user.email,
        changedAt: body.changedAt || new Date().toISOString(),
      };
      await app.prisma.development.update({
        where: { projectId: request.params.id },
        data: { changeLog: [entry, ...current] as any },
      });
      return reply.code(201).send(entry);
    },
  );

  // DELETE /projects/:id/development/changelog/:entryId
  app.delete<{ Params: { id: string; entryId: string } }>(
    '/:id/development/changelog/:entryId',
    auth,
    async (request, reply) => {
      const dev = await app.prisma.development.findUnique({ where: { projectId: request.params.id } });
      const current = Array.isArray(dev?.changeLog) ? dev!.changeLog as any[] : [];
      await app.prisma.development.upsert({
        where: { projectId: request.params.id },
        update: { changeLog: current.filter((entry) => entry.id !== request.params.entryId) as any },
        create: { projectId: request.params.id, changeLog: [] as any },
      });
      return reply.code(204).send();
    },
  );


  // PUT /projects/:id/development/qa-template
  app.put<{ Params: { id: string }; Body: { items?: { id: string; label: string }[] } }>(
    '/:id/development/qa-template',
    auth,
    async (request) => {
      const items = Array.isArray(request.body?.items) ? request.body.items : [];
      const dev = await app.prisma.development.upsert({
        where: { projectId: request.params.id },
        update: { qaTemplate: items as any },
        create: { projectId: request.params.id, qaTemplate: items as any },
      });
      return { items: arrayFromJson(dev.qaTemplate) };
    },
  );

  // POST /projects/:id/development/maintenance-requests
  app.post<{ Params: { id: string }; Body: MaintenanceRequestBody }>(
    '/:id/development/maintenance-requests',
    auth,
    async (request, reply) => {
      const body = request.body ?? {};
      if (!body.title || !body.description) {
        return reply.code(400).send({ error: 'title and description are required' });
      }
      const dev = await app.prisma.development.upsert({
        where: { projectId: request.params.id },
        update: {},
        create: { projectId: request.params.id },
      });
      const current = arrayFromJson(dev.maintenanceRequests);
      const entry = {
        id: `mr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        title: body.title,
        description: body.description,
        priority: body.priority ?? 'MEDIUM',
        target: body.target ?? '',
        requestedBy: body.requestedBy || request.user.email,
        status: 'OPEN',
        createdAt: new Date().toISOString(),
      };
      await app.prisma.development.update({
        where: { projectId: request.params.id },
        data: { maintenanceRequests: [entry, ...current] as any },
      });
      return reply.code(201).send(entry);
    },
  );

  // PATCH /projects/:id/development/maintenance-requests/:requestId
  app.patch<{ Params: { id: string; requestId: string }; Body: { status?: string } }>(
    '/:id/development/maintenance-requests/:requestId',
    auth,
    async (request, reply) => {
      const dev = await app.prisma.development.findUnique({ where: { projectId: request.params.id } });
      const current = arrayFromJson(dev?.maintenanceRequests);
      const updated = current.map(entry => entry.id === request.params.requestId ? { ...entry, status: request.body?.status ?? entry.status } : entry);
      await app.prisma.development.upsert({
        where: { projectId: request.params.id },
        update: { maintenanceRequests: updated as any },
        create: { projectId: request.params.id, maintenanceRequests: [] as any },
      });
      return reply.send(updated.find(entry => entry.id === request.params.requestId) ?? null);
    },
  );

  // DELETE /projects/:id/development/maintenance-requests/:requestId
  app.delete<{ Params: { id: string; requestId: string } }>(
    '/:id/development/maintenance-requests/:requestId',
    auth,
    async (request, reply) => {
      const dev = await app.prisma.development.findUnique({ where: { projectId: request.params.id } });
      const current = arrayFromJson(dev?.maintenanceRequests);
      await app.prisma.development.upsert({
        where: { projectId: request.params.id },
        update: { maintenanceRequests: current.filter(entry => entry.id !== request.params.requestId) as any },
        create: { projectId: request.params.id, maintenanceRequests: [] as any },
      });
      return reply.code(204).send();
    },
  );

  // POST /projects/:id/development/uptime-check
  app.post<{ Params: { id: string } }>(
    '/:id/development/uptime-check',
    auth,
    async (request) => {
      const dev = await app.prisma.development.upsert({
        where: { projectId: request.params.id },
        update: {},
        create: { projectId: request.params.id },
      });
      const liveUrl = dev.liveUrl;
      const checkedAt = new Date();
      if (!liveUrl) {
        const updated = await app.prisma.development.update({
          where: { projectId: request.params.id },
          data: { uptimeStatus: 'UNKNOWN', uptimeResponseTime: null, uptimeLastChecked: checkedAt },
        });
        return { status: updated.uptimeStatus, responseTime: updated.uptimeResponseTime, lastChecked: updated.uptimeLastChecked };
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);
      const started = Date.now();
      let status = 'DOWN';
      let responseTime: number | null = null;
      try {
        const res = await fetch(liveUrl, { method: 'HEAD', signal: controller.signal });
        responseTime = Date.now() - started;
        status = res.ok ? 'UP' : 'DEGRADED';
      } catch {
        responseTime = Date.now() - started;
        status = 'DOWN';
      } finally {
        clearTimeout(timeout);
      }

      const updated = await app.prisma.development.update({
        where: { projectId: request.params.id },
        data: { uptimeStatus: status, uptimeResponseTime: responseTime, uptimeLastChecked: checkedAt },
      });
      return { status: updated.uptimeStatus, responseTime: updated.uptimeResponseTime, lastChecked: updated.uptimeLastChecked };
    },
  );
  // POST /projects/:id/development/backup
  app.post<{ Params: { id: string } }>('/:id/development/backup', auth, async (request) => {
    const dev = await app.prisma.development.upsert({
      where: { projectId: request.params.id },
      update: {},
      create: { projectId: request.params.id },
    });
    const current = Array.isArray(dev.backupLog) ? dev.backupLog as any[] : [];
    const entry = {
      date: new Date().toISOString(),
      provider: 'Manual',
      size: 'N/A',
      note: `Triggered by ${request.user.email}`,
    };
    const backupHistory = [entry, ...current];
    await app.prisma.development.update({
      where: { projectId: request.params.id },
      data: { backupLog: backupHistory as any },
    });
    return { message: 'Backup logged', backupHistory };
  });
};

export default developmentRoutes;
