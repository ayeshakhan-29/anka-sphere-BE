import { FastifyPluginAsync } from 'fastify';
import { decryptText } from '../utils/wp-crypto.js';
import {
  deploymentQueueItemSchema,
  deploymentQueueUpdateSchema,
  deployRequestSchema,
  qaUpdateSchema,
  DeploymentQueueItemBody,
  DeploymentQueueUpdateBody,
  DeployRequestBody,
  QaUpdateBody,
} from '../schemas/wp-deployment.js';

async function wpRequest(
  siteUrl: string,
  username: string,
  appPassword: string,
  method: 'POST' | 'PUT',
  endpoint: string,
  body: Record<string, unknown>,
) {
  const url = `${siteUrl.replace(/\/$/, '')}/wp-json/wp/v2/${endpoint}`;
  const auth = Buffer.from(`${username}:${appPassword}`).toString('base64');
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message ?? `WP API error: ${res.status}`);
  }
  return data as Record<string, unknown>;
}

const developmentDeploymentRoutes: FastifyPluginAsync = async (app) => {
  const auth = { preHandler: [app.authenticate] };

  // ── Queue CRUD ────────────────────────────────────────────────────────────────

  // GET /projects/:id/development/queue
  app.get<{ Params: { id: string } }>(
    '/:id/development/queue',
    auth,
    async (request) => {
      return app.prisma.deploymentQueueItem.findMany({
        where: { projectId: request.params.id },
        orderBy: { createdAt: 'desc' },
        include: {
          page: true,
          logs: { orderBy: { createdAt: 'desc' } },
        },
      });
    },
  );

  // POST /projects/:id/development/queue
  app.post<{ Params: { id: string }; Body: DeploymentQueueItemBody }>(
    '/:id/development/queue',
    auth,
    async (request) => {
      const body = deploymentQueueItemSchema.parse(request.body);
      return app.prisma.deploymentQueueItem.create({
        data: {
          projectId: request.params.id,
          contentKind: body.contentKind,
          pageId: body.pageId,
          postId: body.postId,
          title: body.title,
          slug: body.slug,
          targetEnv: body.targetEnv,
        },
      });
    },
  );

  // PATCH /projects/:id/development/queue/:itemId
  app.patch<{ Params: { id: string; itemId: string }; Body: DeploymentQueueUpdateBody }>(
    '/:id/development/queue/:itemId',
    auth,
    async (request) => {
      const body = deploymentQueueUpdateSchema.parse(request.body);
      return app.prisma.deploymentQueueItem.update({
        where: { id: request.params.itemId },
        data: body as any,
      });
    },
  );

  // DELETE /projects/:id/development/queue/:itemId
  app.delete<{ Params: { id: string; itemId: string } }>(
    '/:id/development/queue/:itemId',
    auth,
    async (request, reply) => {
      await app.prisma.deploymentQueueItem.delete({ where: { id: request.params.itemId } });
      return reply.code(204).send();
    },
  );

  // ── QA ────────────────────────────────────────────────────────────────────────

  // PATCH /projects/:id/development/queue/:itemId/qa
  app.patch<{ Params: { id: string; itemId: string }; Body: QaUpdateBody }>(
    '/:id/development/queue/:itemId/qa',
    auth,
    async (request) => {
      const body = qaUpdateSchema.parse(request.body);
      return app.prisma.deploymentQueueItem.update({
        where: { id: request.params.itemId },
        data: {
          qaStatus: body.qaStatus,
          qaNotes: body.qaNotes,
          qaChecklist: body.qaChecklist ?? undefined,
        } as any,
      });
    },
  );

  // ── Deploy ─────────────────────────────────────────────────────────────────────

  // POST /projects/:id/development/deploy
  app.post<{ Params: { id: string }; Body: DeployRequestBody }>(
    '/:id/development/deploy',
    auth,
    async (request, reply) => {
      const body = deployRequestSchema.parse(request.body);
      const item = await app.prisma.deploymentQueueItem.findUnique({
        where: { id: body.queueItemId },
        include: { page: true },
      });
      if (!item) {
        return reply.code(404).send({ error: 'Queue item not found' });
      }

      // Production gate
      if (body.targetEnv === 'PRODUCTION') {
        if (!body.confirmProduction) {
          return reply.code(400).send({ error: 'Production deployment requires explicit confirmation (confirmProduction: true)' });
        }
        if (item.qaStatus !== 'PASS') {
          return reply.code(400).send({ error: 'QA status must be PASS before deploying to Production' });
        }
      }

      const connection = await app.prisma.wpConnection.findUnique({
        where: { projectId_env: { projectId: request.params.id, env: body.targetEnv } },
      });
      if (!connection || !connection.wpAppPasswordEnc) {
        return reply.code(400).send({ error: `No WP connection configured for ${body.targetEnv}` });
      }

      // Fetch content from the approved ContentPage linked to this queue item.
      const linkedPage = item.pageId && !item.page ? await app.prisma.contentPage.findUnique({ where: { id: item.pageId } }) : item.page;
      const contentBody = linkedPage?.body ?? item.title;
      const seoTitle = linkedPage?.seoTitle ?? undefined;
      const seoDescription = linkedPage?.seoDescription ?? undefined;

      const appPassword = decryptText(connection.wpAppPasswordEnc);
      const endpoint = item.contentKind === 'PAGE' ? 'pages' : 'posts';
      const wpBody: Record<string, unknown> = {
        title: item.title,
        content: contentBody,
        slug: item.slug ?? undefined,
        status: 'publish',
      };
      if (seoTitle) wpBody.meta = { ...(wpBody.meta as Record<string, unknown> ?? {}), _yoast_wpseo_title: seoTitle };
      if (seoDescription) wpBody.excerpt = seoDescription;
      if (item.wpPostId) wpBody.id = item.wpPostId;

      // Fetch user info for logging
      const dbUser = await app.prisma.user.findUnique({
        where: { id: request.user.sub },
      });
      const pushedBy = dbUser ? `${dbUser.name} (${dbUser.email})` : request.user.email;

      const start = Date.now();
      try {
        const method = item.wpPostId ? 'PUT' : 'POST';
        const ep = item.wpPostId ? `${endpoint}/${item.wpPostId}` : endpoint;
        const result = await wpRequest(
          connection.siteUrl,
          connection.wpUsername,
          appPassword,
          method as 'POST' | 'PUT',
          ep,
          wpBody,
        );

        await app.prisma.$transaction([
          app.prisma.deploymentQueueItem.update({
            where: { id: item.id },
            data: {
              status: body.targetEnv === 'PRODUCTION' ? 'LIVE_DONE' : 'STAGING_DONE',
              wpPostId: (result.id as number) ?? item.wpPostId,
              wpUrl: (result.link as string) ?? undefined,
              deployedAt: new Date(),
              errorMessage: null,
            },
          }),
          app.prisma.deploymentLog.create({
            data: {
              queueItemId: item.id,
              env: body.targetEnv,
              status: 'SUCCESS',
              requestBody: wpBody as any,
              responseBody: result as any,
              durationMs: Date.now() - start,
              pushedBy,
            },
          }),
        ]);

        return { message: `Deployed to ${body.targetEnv} successfully`, result };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';

        await app.prisma.$transaction([
          app.prisma.deploymentQueueItem.update({
            where: { id: item.id },
            data: { status: 'FAILED', errorMessage: message },
          }),
          app.prisma.deploymentLog.create({
            data: {
              queueItemId: item.id,
              env: body.targetEnv,
              status: 'ERROR',
              requestBody: wpBody as any,
              errorMessage: message,
              durationMs: Date.now() - start,
              pushedBy,
            },
          }),
        ]);

        return reply.code(502).send({ error: `Deploy failed: ${message}` });
      }
    },
  );

  // ── Sync Approved Pages ───────────────────────────────────────────────────────

  // POST /projects/:id/development/queue/sync-approved
  app.post<{ Params: { id: string } }>(
    '/:id/development/queue/sync-approved',
    auth,
    async (request, reply) => {
      const projectId = request.params.id;

      // Get existing queue pageIds to avoid duplicates
      const existingItems = await app.prisma.deploymentQueueItem.findMany({
        where: { projectId },
        select: { pageId: true },
      });
      const existingPageIds = new Set(
        existingItems.map(i => i.pageId).filter((id): id is string => !!id),
      );

      // Get approved content pages for this project
      const writtenContent = await app.prisma.writtenContent.findUnique({
        where: { projectId },
        include: { pages: { where: { status: 'APPROVED' } } },
      });

      if (!writtenContent) {
        return { count: 0, items: [] };
      }

      const pagesToSync = writtenContent.pages.filter(p => !existingPageIds.has(p.id));

      if (pagesToSync.length === 0) {
        return { count: 0, items: [] };
      }

      const items = await app.prisma.$transaction(
        pagesToSync.map(page =>
          app.prisma.deploymentQueueItem.create({
            data: {
              projectId,
              contentKind: 'PAGE',
              pageId: page.id,
              title: page.title,
              slug: page.slug ?? undefined,
              targetEnv: 'STAGING',
            },
          }),
        ),
      );

      return { count: items.length, items };
    },
  );

  // ── Logs ──────────────────────────────────────────────────────────────────────

  // GET /projects/:id/development/queue/:itemId/logs
  app.get<{ Params: { id: string; itemId: string } }>(
    '/:id/development/queue/:itemId/logs',
    auth,
    async (request) => {
      return app.prisma.deploymentLog.findMany({
        where: { queueItemId: request.params.itemId },
        orderBy: { createdAt: 'desc' },
      });
    },
  );

  // GET /projects/:id/development/logs
  app.get<{ Params: { id: string } }>(
    '/:id/development/logs',
    auth,
    async (request) => {
      const items = await app.prisma.deploymentQueueItem.findMany({
        where: { projectId: request.params.id },
        select: { id: true },
      });
      const queueItemIds = items.map(i => i.id);
      if (queueItemIds.length === 0) return [];
      return app.prisma.deploymentLog.findMany({
        where: { queueItemId: { in: queueItemIds } },
        orderBy: { createdAt: 'desc' },
      });
    },
  );
};

export default developmentDeploymentRoutes;
