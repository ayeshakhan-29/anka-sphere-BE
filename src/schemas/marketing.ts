import { z } from 'zod';

export const upsertMarketingSchema = z.object({
  strategy:       z.string().optional(),
  targetAudience: z.string().optional(),
  budget:         z.string().optional(),
  channels:       z.string().optional(),
  notes:          z.string().optional(),
});

export const marketingTaskSchema = z.object({
  title:        z.string().min(1),
  description:  z.string().optional(),
  status:       z.enum(['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE']).optional(),
  priority:     z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
  category:     z.enum(['CONTENT', 'SOCIAL', 'PAID', 'SEO', 'ANALYTICS', 'OTHER']).optional(),
  assigneeName: z.string().optional(),
  dueDate:      z.string().datetime().optional(),
  sortOrder:    z.number().int().optional(),
});

export type UpsertMarketingBody  = z.infer<typeof upsertMarketingSchema>;
export type MarketingTaskBody    = z.infer<typeof marketingTaskSchema>;
