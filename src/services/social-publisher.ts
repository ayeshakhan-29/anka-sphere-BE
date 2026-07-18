import cron from 'node-cron';
import { FastifyInstance } from 'fastify';
import { publishSocialPost } from '../routes/social-posts.js';

/** Publish due SCHEDULED posts. Failures flip individual posts to FAILED. */
async function publishDuePosts(app: FastifyInstance): Promise<void> {
  const due = await app.prisma.socialPost.findMany({
    where: { status: 'SCHEDULED', scheduledAt: { lte: new Date() } },
    include: { mediaAsset: { select: { id: true, name: true, type: true, url: true, thumbnailUrl: true } } },
    take: 20, // safety cap per tick
  });

  for (const post of due) {
    try {
      await publishSocialPost(app, post);
      app.log.info({ postId: post.id, platform: post.platform }, 'Scheduled social post published');
    } catch (err) {
      // publishSocialPost already marked the post FAILED with the message
      app.log.error({ err, postId: post.id }, 'Scheduled social post failed');
    }
  }
}

export function startSocialPublisher(app: FastifyInstance): void {
  // Every 5 minutes — same node-cron pattern as report-scheduler
  cron.schedule('*/5 * * * *', () => {
    publishDuePosts(app).catch((err) => app.log.error({ err }, 'Social publisher tick failed'));
  });
  app.log.info('Social post publisher scheduled (every 5 minutes)');
}
