import { FastifyPluginAsync } from 'fastify';
import {
  upsertWrittenContentSchema,
  contentPageSchema,
  updatePageStatusSchema,
  UpsertWrittenContentBody,
  ContentPageBody,
  UpdatePageStatusBody,
} from '../schemas/written-content.js';
import { notifyGateHandoff } from '../services/handoff.js';

const writtenContentRoutes: FastifyPluginAsync = async (app) => {
  const auth = { preHandler: [app.authenticate] };

  // ── Written Content brief ─────────────────────────────────────────────────

  // GET /projects/:id/content
  app.get<{ Params: { id: string } }>('/:id/content', auth, async (request, reply) => {
    const content = await app.prisma.writtenContent.findUnique({
      where: { projectId: request.params.id },
      include: { pages: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!content) return reply.code(404).send({ error: 'Written content not found' });
    return content;
  });

  // PUT /projects/:id/content
  app.put<{ Params: { id: string }; Body: UpsertWrittenContentBody }>(
    '/:id/content',
    auth,
    async (request) => {
      const body = upsertWrittenContentSchema.parse(request.body);
      return app.prisma.writtenContent.upsert({
        where: { projectId: request.params.id },
        update: body,
        create: { ...body, projectId: request.params.id },
        include: { pages: { orderBy: { sortOrder: 'asc' } } },
      });
    },
  );

  // POST /projects/:id/content/complete  (Hard Gate)
  app.post<{ Params: { id: string } }>('/:id/content/complete', auth, async (request, reply) => {
    const content = await app.prisma.writtenContent.findUnique({
      where: { projectId: request.params.id },
      include: { pages: true },
    });

    if (!content) {
      return reply.code(422).send({ error: 'No written content found for this project.' });
    }

    const approvedPages = content.pages.filter((p: { status: string }) => p.status === 'APPROVED');
    if (approvedPages.length === 0) {
      return reply.code(422).send({ error: 'At least one content page must be approved before passing the Hard Gate.' });
    }

    await app.prisma.$transaction([
      app.prisma.writtenContent.update({
        where: { projectId: request.params.id },
        data: { completedAt: new Date() },
      }),
      app.prisma.pipelineEntry.update({
        where: { projectId_stage: { projectId: request.params.id, stage: 'WRITTEN_CONTENT' } },
        data: { status: 'APPROVED', approvedAt: new Date() },
      }),
      app.prisma.pipelineEntry.update({
        where: { projectId_stage: { projectId: request.params.id, stage: 'DESIGN' } },
        data: { status: 'IN_PROGRESS', startedAt: new Date() },
      }),
      app.prisma.project.update({
        where: { id: request.params.id },
        data: { currentStage: 'DESIGN' },
      }),
    ]);

    notifyGateHandoff(app, request.params.id, 'WRITTEN_CONTENT', 'DESIGN');
    return { message: 'Written Content approved. Design stage is now unlocked.' };
  });

  // ── Content Pages ─────────────────────────────────────────────────────────

  // POST /projects/:id/content/pages
  app.post<{ Params: { id: string }; Body: ContentPageBody }>(
    '/:id/content/pages',
    auth,
    async (request, reply) => {
      const body = contentPageSchema.parse(request.body);
      const wc = await app.prisma.writtenContent.upsert({
        where: { projectId: request.params.id },
        update: {},
        create: { projectId: request.params.id },
      });
      const page = await app.prisma.contentPage.create({
        data: { ...body, writtenContentId: wc.id },
      });
      return reply.code(201).send(page);
    },
  );

  // GET /projects/:id/content/pages/:pageId
  app.get<{ Params: { id: string; pageId: string } }>(
    '/:id/content/pages/:pageId',
    auth,
    async (request, reply) => {
      const page = await app.prisma.contentPage.findUnique({
        where: { id: request.params.pageId },
        include: { comments: { include: { author: { select: { id: true, name: true, avatarUrl: true } } }, orderBy: { createdAt: 'asc' } } },
      });
      if (!page) return reply.code(404).send({ error: 'Page not found' });
      return page;
    },
  );

  // PATCH /projects/:id/content/pages/:pageId
  app.patch<{ Params: { id: string; pageId: string }; Body: ContentPageBody }>(
    '/:id/content/pages/:pageId',
    auth,
    async (request) => {
      const body = contentPageSchema.partial().parse(request.body);
      return app.prisma.contentPage.update({
        where: { id: request.params.pageId },
        data: body,
      });
    },
  );

  // PATCH /projects/:id/content/pages/:pageId/status
  app.patch<{ Params: { id: string; pageId: string }; Body: UpdatePageStatusBody }>(
    '/:id/content/pages/:pageId/status',
    auth,
    async (request) => {
      const { status } = updatePageStatusSchema.parse(request.body);
      const page = await app.prisma.contentPage.update({
        where: { id: request.params.pageId },
        data: { status },
      });

      if (status === 'APPROVED') {
        // Auto-populate in Staging deployment queue if not already there
        const existing = await app.prisma.deploymentQueueItem.findFirst({
          where: { projectId: request.params.id, pageId: page.id },
        });
        if (!existing) {
          await app.prisma.deploymentQueueItem.create({
            data: {
              projectId: request.params.id,
              contentKind: 'PAGE',
              pageId: page.id,
              title: page.title,
              slug: page.slug,
              targetEnv: 'STAGING',
              status: 'QUEUED',
            },
          });
        }
      }

      return page;
    },
  );

  // DELETE /projects/:id/content/pages/:pageId
  app.delete<{ Params: { id: string; pageId: string } }>(
    '/:id/content/pages/:pageId',
    auth,
    async (_, reply) => {
      await app.prisma.contentPage.delete({ where: { id: _.params.pageId } });
      return reply.code(204).send();
    },
  );

  // ── Comments on content pages ─────────────────────────────────────────────

  // POST /projects/:id/content/pages/:pageId/comments
  app.post<{ Params: { id: string; pageId: string }; Body: { body: string } }>(
    '/:id/content/pages/:pageId/comments',
    auth,
    async (request, reply) => {
      const comment = await app.prisma.comment.create({
        data: {
          body: request.body.body,
          authorId: request.user.sub,
          contentPageId: request.params.pageId,
          projectId: request.params.id,
        },
        include: { author: { select: { id: true, name: true, avatarUrl: true } } },
      });
      return reply.code(201).send(comment);
    },
  );
};

export default writtenContentRoutes;
