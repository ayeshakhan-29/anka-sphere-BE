import { z } from 'zod';

export const upsertWrittenContentSchema = z.object({
  contentBrief:  z.string().optional(),
  toneOfVoice:   z.string().optional(),
  seoGuidelines: z.string().optional(),
});

export const contentPageSchema = z.object({
  title:          z.string().min(1),
  slug:           z.string().optional(),
  body:           z.string().optional(),
  status:         z.enum(['DRAFT', 'IN_REVIEW', 'APPROVED', 'PUBLISHED']).optional(),
  wordCount:      z.number().int().optional(),
  seoTitle:       z.string().optional(),
  seoDescription: z.string().optional(),
  sortOrder:      z.number().int().optional(),
  pillarId:       z.string().nullable().optional(),
});

export const updatePageStatusSchema = z.object({
  status: z.enum(['DRAFT', 'IN_REVIEW', 'APPROVED', 'PUBLISHED']),
});

export type UpsertWrittenContentBody = z.infer<typeof upsertWrittenContentSchema>;
export type ContentPageBody = z.infer<typeof contentPageSchema>;
export type UpdatePageStatusBody = z.infer<typeof updatePageStatusSchema>;
