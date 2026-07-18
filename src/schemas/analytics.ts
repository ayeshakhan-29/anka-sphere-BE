import { z } from 'zod';

/** Shared by GA4 / GSC / ads metric endpoints — `?range=7|30|90&refresh=true`. */
export const metricsQuerySchema = z.object({
  range: z.coerce.number().int().refine((v) => [7, 30, 90].includes(v), 'range must be 7, 30 or 90').default(30),
  refresh: z.coerce.boolean().default(false),
});

export type MetricsQuery = z.infer<typeof metricsQuerySchema>;
