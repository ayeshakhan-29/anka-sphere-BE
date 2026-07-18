import { z } from 'zod';

export const createSocialPostSchema = z.object({
  platform: z.enum(['INSTAGRAM', 'TIKTOK', 'FACEBOOK', 'LINKEDIN', 'X']),
  caption: z.string().min(1).max(5000),
  hashtags: z.string().max(1000).nullish(),
  mediaAssetId: z.string().nullish(),
  scheduledAt: z.coerce.date().nullish(),
  status: z.enum(['DRAFT', 'SCHEDULED']).default('DRAFT'),
  createdByName: z.string().max(120).nullish(),
});

export const updateSocialPostSchema = createSocialPostSchema.partial();

export type CreateSocialPostBody = z.infer<typeof createSocialPostSchema>;
export type UpdateSocialPostBody = z.infer<typeof updateSocialPostSchema>;
