import { z } from 'zod';

export const upsertDesignBriefSchema = z.object({
  brief:      z.string().optional(),
  styleGuide: z.string().optional(),
  figmaUrl:   z.string().url().optional().or(z.literal('')),
});

export const designTaskSchema = z.object({
  title:        z.string().min(1),
  description:  z.string().optional(),
  status:       z.enum(['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE']).optional(),
  priority:     z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
  assigneeName: z.string().optional(),
  dueDate:      z.string().datetime().optional(),
  sortOrder:    z.number().int().optional(),
});

export const designAssetSchema = z.object({
  name:         z.string().min(1),
  type:         z.enum(['IMAGE', 'VIDEO', 'FONT', 'DOCUMENT', 'OTHER']).optional(),
  url:          z.string().min(1),
  thumbnailUrl: z.string().optional(),
  fileSize:     z.number().int().optional(),
  version:      z.number().int().optional(),
  notes:        z.string().optional(),
});

export type UpsertDesignBriefBody = z.infer<typeof upsertDesignBriefSchema>;
export type DesignTaskBody        = z.infer<typeof designTaskSchema>;
export type DesignAssetBody       = z.infer<typeof designAssetSchema>;
