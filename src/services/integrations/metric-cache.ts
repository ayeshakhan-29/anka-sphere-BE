import { FastifyInstance } from 'fastify';
import { MetricSource } from '@prisma/client';

const TTL_MS = 60 * 60 * 1000; // ~1 h — respects provider rate limits

/**
 * Read-through cache over MetricSnapshot (`@@unique([projectId, source, period])`).
 * `period` encodes the query shape (e.g. "30d"); pass `force` to bypass the TTL.
 */
export async function cachedMetrics<T>(
  app: FastifyInstance,
  projectId: string,
  source: MetricSource,
  period: string,
  force: boolean,
  fetcher: () => Promise<T>,
): Promise<{ data: T; fetchedAt: Date; cached: boolean }> {
  const where = { projectId_source_period: { projectId, source, period } };

  if (!force) {
    const snap = await app.prisma.metricSnapshot.findUnique({ where });
    if (snap && snap.fetchedAt.getTime() > Date.now() - TTL_MS) {
      return { data: snap.data as T, fetchedAt: snap.fetchedAt, cached: true };
    }
  }

  const data = await fetcher();
  const snap = await app.prisma.metricSnapshot.upsert({
    where,
    update: { data: data as object, fetchedAt: new Date() },
    create: { projectId, source, period, data: data as object },
  });
  return { data, fetchedAt: snap.fetchedAt, cached: false };
}
