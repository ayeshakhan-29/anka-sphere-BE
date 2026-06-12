import { FastifyPluginAsync } from 'fastify';
import {
  createProjectSchema,
  updateProjectSchema,
  upsertProfilingSchema,
  personaSchema,
  competitorSchema,
  milestoneSchema,
  CreateProjectBody,
  UpdateProjectBody,
  UpsertProfilingBody,
  PersonaBody,
  CompetitorBody,
  MilestoneBody,
} from '../schemas/project.js';

const projectRoutes: FastifyPluginAsync = async (app) => {
  const auth = { preHandler: [app.authenticate] };

  // ── Projects CRUD ────────────────────────────────────────────────────────

  // GET /projects
  app.get('/', auth, async (request) => {
    const projects = await app.prisma.project.findMany({
      orderBy: { updatedAt: 'desc' },
      include: {
        members: { include: { user: { select: { id: true, name: true, avatarUrl: true } } } },
        pipeline: true,
        _count: { select: { milestones: true } },
      },
    });
    return projects;
  });

  // GET /projects/:id
  app.get<{ Params: { id: string } }>('/:id', auth, async (request, reply) => {
    const project = await app.prisma.project.findUnique({
      where: { id: request.params.id },
      include: {
        members: { include: { user: { select: { id: true, name: true, avatarUrl: true, role: true } } } },
        pipeline: { orderBy: { stage: 'asc' } },
        milestones: { orderBy: { sortOrder: 'asc' } },
        profiling:   { include: { personas: true, competitors: true } },
        content:     { include: { pages: { orderBy: { sortOrder: 'asc' } } } },
        design:      { include: { tasks: true, assets: true } },
        development: { include: { tasks: { orderBy: [{ status: 'asc' }, { sortOrder: 'asc' }] } } },
        marketing:   { include: { tasks: { orderBy: [{ status: 'asc' }, { sortOrder: 'asc' }] } } },
      },
    });
    if (!project) return reply.code(404).send({ error: 'Project not found' });
    return project;
  });

  // POST /projects
  app.post<{ Body: CreateProjectBody }>('/', auth, async (request, reply) => {
    const body = createProjectSchema.parse(request.body);
    const project = await app.prisma.project.create({
      data: {
        ...body,
        createdById: request.user.sub,
        startDate: body.startDate ? new Date(body.startDate) : undefined,
        targetDate: body.targetDate ? new Date(body.targetDate) : undefined,
        // Seed pipeline entries for all 5 stages
        pipeline: {
          create: [
            { stage: 'PROFILING',       status: 'IN_PROGRESS' },
            { stage: 'WRITTEN_CONTENT', status: 'LOCKED' },
            { stage: 'DESIGN',          status: 'LOCKED' },
            { stage: 'DEVELOPMENT',     status: 'LOCKED' },
            { stage: 'MARKETING',       status: 'LOCKED' },
          ],
        },
      },
      include: { pipeline: true },
    });
    return reply.code(201).send(project);
  });

  // PATCH /projects/:id
  app.patch<{ Params: { id: string }; Body: UpdateProjectBody }>('/:id', auth, async (request, reply) => {
    const body = updateProjectSchema.parse(request.body);
    const project = await app.prisma.project.update({
      where: { id: request.params.id },
      data: {
        ...body,
        startDate: body.startDate ? new Date(body.startDate) : undefined,
        targetDate: body.targetDate ? new Date(body.targetDate) : undefined,
      },
    });
    return project;
  });

  // DELETE /projects/:id
  app.delete<{ Params: { id: string } }>('/:id', auth, async (request, reply) => {
    await app.prisma.project.delete({ where: { id: request.params.id } });
    return reply.code(204).send();
  });

  // ── Profiling ────────────────────────────────────────────────────────────

  // PUT /projects/:id/profiling
  app.put<{ Params: { id: string }; Body: UpsertProfilingBody }>(
    '/:id/profiling',
    auth,
    async (request) => {
      const body = upsertProfilingSchema.parse(request.body);
      const profiling = await app.prisma.projectProfiling.upsert({
        where: { projectId: request.params.id },
        update: body,
        create: { ...body, projectId: request.params.id },
        include: { personas: true, competitors: true },
      });
      return profiling;
    },
  );

  // POST /projects/:id/profiling/complete  (triggers Hard Gate)
  app.post<{ Params: { id: string } }>('/:id/profiling/complete', auth, async (request, reply) => {
    const profiling = await app.prisma.projectProfiling.findUnique({
      where: { projectId: request.params.id },
    });
    if (!profiling?.companyName || !profiling?.objectives || !profiling?.primaryKeywords) {
      return reply.code(422).send({ error: 'Required profiling fields missing before gate can be approved.' });
    }
    await app.prisma.$transaction([
      app.prisma.projectProfiling.update({
        where: { projectId: request.params.id },
        data: { completedAt: new Date() },
      }),
      app.prisma.pipelineEntry.update({
        where: { projectId_stage: { projectId: request.params.id, stage: 'PROFILING' } },
        data: { status: 'APPROVED', approvedAt: new Date() },
      }),
      app.prisma.pipelineEntry.update({
        where: { projectId_stage: { projectId: request.params.id, stage: 'WRITTEN_CONTENT' } },
        data: { status: 'IN_PROGRESS', startedAt: new Date() },
      }),
      app.prisma.project.update({
        where: { id: request.params.id },
        data: { currentStage: 'WRITTEN_CONTENT' },
      }),
    ]);
    return { message: 'Profiling approved. Written Content stage is now unlocked.' };
  });

  // ── Personas ─────────────────────────────────────────────────────────────

  // POST /projects/:id/profiling/personas
  app.post<{ Params: { id: string }; Body: PersonaBody }>(
    '/:id/profiling/personas',
    auth,
    async (request, reply) => {
      const body = personaSchema.parse(request.body);
      const profiling = await app.prisma.projectProfiling.upsert({
        where: { projectId: request.params.id },
        update: {},
        create: { projectId: request.params.id },
      });
      const persona = await app.prisma.persona.create({
        data: { ...body, profilingId: profiling.id },
      });
      return reply.code(201).send(persona);
    },
  );

  // PATCH /projects/:id/profiling/personas/:personaId
  app.patch<{ Params: { id: string; personaId: string }; Body: PersonaBody }>(
    '/:id/profiling/personas/:personaId',
    auth,
    async (request) => {
      return app.prisma.persona.update({
        where: { id: request.params.personaId },
        data: personaSchema.partial().parse(request.body),
      });
    },
  );

  // DELETE /projects/:id/profiling/personas/:personaId
  app.delete<{ Params: { id: string; personaId: string } }>(
    '/:id/profiling/personas/:personaId',
    auth,
    async (_, reply) => {
      await app.prisma.persona.delete({ where: { id: _.params.personaId } });
      return reply.code(204).send();
    },
  );

  // ── Competitors ───────────────────────────────────────────────────────────

  // POST /projects/:id/profiling/competitors
  app.post<{ Params: { id: string }; Body: CompetitorBody }>(
    '/:id/profiling/competitors',
    auth,
    async (request, reply) => {
      const body = competitorSchema.parse(request.body);
      const profiling = await app.prisma.projectProfiling.upsert({
        where: { projectId: request.params.id },
        update: {},
        create: { projectId: request.params.id },
      });
      const competitor = await app.prisma.competitor.create({
        data: { ...body, profilingId: profiling.id },
      });
      return reply.code(201).send(competitor);
    },
  );

  // PATCH /projects/:id/profiling/competitors/:compId
  app.patch<{ Params: { id: string; compId: string }; Body: CompetitorBody }>(
    '/:id/profiling/competitors/:compId',
    auth,
    async (request) => {
      return app.prisma.competitor.update({
        where: { id: request.params.compId },
        data: competitorSchema.partial().parse(request.body),
      });
    },
  );

  // DELETE /projects/:id/profiling/competitors/:compId
  app.delete<{ Params: { id: string; compId: string } }>(
    '/:id/profiling/competitors/:compId',
    auth,
    async (_, reply) => {
      await app.prisma.competitor.delete({ where: { id: _.params.compId } });
      return reply.code(204).send();
    },
  );

  // ── Milestones ────────────────────────────────────────────────────────────

  // GET /projects/:id/milestones
  app.get<{ Params: { id: string } }>('/:id/milestones', auth, async (request) => {
    return app.prisma.milestone.findMany({
      where: { projectId: request.params.id },
      orderBy: { sortOrder: 'asc' },
    });
  });

  // POST /projects/:id/milestones
  app.post<{ Params: { id: string }; Body: MilestoneBody }>(
    '/:id/milestones',
    auth,
    async (request, reply) => {
      const body = milestoneSchema.parse(request.body);
      const milestone = await app.prisma.milestone.create({
        data: {
          ...body,
          dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
          projectId: request.params.id,
        },
      });
      return reply.code(201).send(milestone);
    },
  );

  // PATCH /projects/:id/milestones/:msId
  app.patch<{ Params: { id: string; msId: string }; Body: MilestoneBody }>(
    '/:id/milestones/:msId',
    auth,
    async (request) => {
      const body = milestoneSchema.partial().parse(request.body);
      return app.prisma.milestone.update({
        where: { id: request.params.msId },
        data: { ...body, dueDate: body.dueDate ? new Date(body.dueDate) : undefined },
      });
    },
  );

  // DELETE /projects/:id/milestones/:msId
  app.delete<{ Params: { id: string; msId: string } }>(
    '/:id/milestones/:msId',
    auth,
    async (_, reply) => {
      await app.prisma.milestone.delete({ where: { id: _.params.msId } });
      return reply.code(204).send();
    },
  );
};

export default projectRoutes;
