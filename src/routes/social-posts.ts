import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { SocialPost } from '@prisma/client';
import { createSocialPostSchema, updateSocialPostSchema, CreateSocialPostBody, UpdateSocialPostBody } from '../schemas/social.js';
import { publishToFacebook, publishToInstagram } from '../services/integrations/meta.js';
import { publishToTiktok } from '../services/integrations/tiktok.js';
import { IntegrationRequestError } from '../services/integrations/errors.js';

const include = { mediaAsset: { select: { id: true, name: true, type: true, url: true, thumbnailUrl: true } } };

/** Publish one post to its platform; returns the updated row. Exported for the cron worker. */
export async function publishSocialPost(app: FastifyInstance, post: SocialPost & { mediaAsset?: { url: string; type: string } | null }): Promise<SocialPost> {
  await app.prisma.socialPost.update({ where: { id: post.id }, data: { status: 'PUBLISHING' } });

  const caption = post.hashtags ? `${post.caption}\n\n${post.hashtags}` : post.caption;
  const mediaUrl = post.mediaAsset?.url ?? null;

  try {
    let result: { externalPostId: string; externalUrl: string | null };
    if (post.platform === 'FACEBOOK') {
      result = await publishToFacebook(app, caption, mediaUrl, post.projectId);
    } else if (post.platform === 'INSTAGRAM') {
      if (!mediaUrl) throw new IntegrationRequestError('Instagram posts need an attached image asset.', 422);
      result = await publishToInstagram(app, caption, mediaUrl, post.projectId);
    } else if (post.platform === 'TIKTOK') {
      if (!mediaUrl) throw new IntegrationRequestError('TikTok posts need an attached video asset.', 422);
      result = await publishToTiktok(app, caption, mediaUrl, post.projectId);
    } else {
      throw new IntegrationRequestError(`Publishing to ${post.platform} is not supported yet — post manually.`, 422);
    }

    return await app.prisma.socialPost.update({
      where: { id: post.id },
      data: {
        status: 'PUBLISHED',
        publishedAt: new Date(),
        externalPostId: result.externalPostId,
        externalUrl: result.externalUrl,
        errorMessage: null,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Publishing failed.';
    await app.prisma.socialPost.update({
      where: { id: post.id },
      data: { status: 'FAILED', errorMessage: message },
    });
    throw err;
  }
}

const socialPostRoutes: FastifyPluginAsync = async (app) => {
  const auth = { preHandler: [app.authenticate] };

  const requireProject = async (id: string) =>
    app.prisma.project.findUnique({ where: { id }, select: { id: true } });

  app.get<{ Params: { id: string } }>('/:id/social/posts', auth, async (request, reply) => {
    if (!(await requireProject(request.params.id))) return reply.code(404).send({ error: 'Project not found' });
    const posts = await app.prisma.socialPost.findMany({
      where: { projectId: request.params.id },
      include,
      orderBy: [{ scheduledAt: 'asc' }, { createdAt: 'desc' }],
    });
    return { posts };
  });

  app.post<{ Params: { id: string }; Body: CreateSocialPostBody }>(
    '/:id/social/posts',
    auth,
    async (request, reply) => {
      if (!(await requireProject(request.params.id))) return reply.code(404).send({ error: 'Project not found' });
      const body = createSocialPostSchema.parse(request.body);

      if (body.status === 'SCHEDULED' && !body.scheduledAt) {
        return reply.code(400).send({ error: 'scheduledAt is required for SCHEDULED posts.' });
      }

      const post = await app.prisma.socialPost.create({
        data: { projectId: request.params.id, ...body },
        include,
      });
      return reply.code(201).send({ post });
    },
  );

  app.patch<{ Params: { id: string; postId: string }; Body: UpdateSocialPostBody }>(
    '/:id/social/posts/:postId',
    auth,
    async (request, reply) => {
      const body = updateSocialPostSchema.parse(request.body);
      const existing = await app.prisma.socialPost.findFirst({
        where: { id: request.params.postId, projectId: request.params.id },
      });
      if (!existing) return reply.code(404).send({ error: 'Post not found' });
      if (existing.status === 'PUBLISHED' || existing.status === 'PUBLISHING') {
        return reply.code(409).send({ error: 'Published posts cannot be edited.' });
      }

      const post = await app.prisma.socialPost.update({
        where: { id: existing.id },
        data: body,
        include,
      });
      return { post };
    },
  );

  app.delete<{ Params: { id: string; postId: string } }>(
    '/:id/social/posts/:postId',
    auth,
    async (request, reply) => {
      const existing = await app.prisma.socialPost.findFirst({
        where: { id: request.params.postId, projectId: request.params.id },
      });
      if (!existing) return reply.code(404).send({ error: 'Post not found' });
      await app.prisma.socialPost.delete({ where: { id: existing.id } });
      return { deleted: true };
    },
  );

  app.post<{ Params: { id: string; postId: string } }>(
    '/:id/social/posts/:postId/publish',
    auth,
    async (request, reply) => {
      const existing = await app.prisma.socialPost.findFirst({
        where: { id: request.params.postId, projectId: request.params.id },
        include,
      });
      if (!existing) return reply.code(404).send({ error: 'Post not found' });
      if (existing.status === 'PUBLISHED') return reply.code(409).send({ error: 'Post is already published.' });
      if (existing.status === 'PUBLISHING') return reply.code(409).send({ error: 'Post is currently being published.' });

      const post = await publishSocialPost(app, existing);
      return { post };
    },
  );

  // ── Community Queue ───────────────────────────────────────────────────────

  app.get<{ Params: { id: string } }>('/:id/social/community-queue', auth, async (request) => {
    return app.prisma.communityQueueItem.findMany({
      where: { projectId: request.params.id },
      orderBy: { createdAt: 'desc' },
    });
  });

  app.post<{ Params: { id: string }; Body: Record<string, any> }>('/:id/social/community-queue', auth, async (request, reply) => {
    const body = (request.body as any) || {};
    const item = await app.prisma.communityQueueItem.create({
      data: {
        projectId: request.params.id,
        platform: body.platform || 'INSTAGRAM',
        userHandle: body.userHandle || '@follower',
        message: body.message || '',
        postTitle: body.postTitle || null,
        assignedTo: body.assignedTo || 'Social Team',
        status: body.status || 'NEEDS_RESPONSE',
      },
    });
    return reply.code(201).send(item);
  });

  app.patch<{ Params: { id: string; itemId: string }; Body: Record<string, any> }>('/:id/social/community-queue/:itemId', auth, async (request) => {
    const body = (request.body as any) || {};
    return app.prisma.communityQueueItem.update({
      where: { id: request.params.itemId },
      data: {
        ...body,
        respondedAt: body.status === 'RESPONDED' ? new Date() : undefined,
      },
    });
  });


  app.delete<{ Params: { id: string; itemId: string } }>('/:id/social/community-queue/:itemId', auth, async (request, reply) => {
    await app.prisma.communityQueueItem.delete({ where: { id: request.params.itemId } });
    return reply.code(204).send();
  });
};

export default socialPostRoutes;

