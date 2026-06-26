import { z } from 'zod';

export const wpConnectionUpsertSchema = z.object({
  siteUrl: z.string().min(1),
  wpUsername: z.string().min(1),
  // app password (only accepts if provided; if omitted we keep existing)
  wpAppPassword: z.string().min(1).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  notes: z.string().optional(),
});

export type WpConnectionUpsertBody = z.infer<typeof wpConnectionUpsertSchema>;

