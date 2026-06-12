import { z } from 'zod';

export const upsertDevelopmentBriefSchema = z.object({
  techStack:  z.string().optional(),
  repoUrl:    z.string().optional(),
  stagingUrl: z.string().optional(),
  liveUrl:    z.string().optional(),
  notes:      z.string().optional(),
});

export const devTaskSchema = z.object({
  title:        z.string().min(1),
  description:  z.string().optional(),
  status:       z.enum(['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE']).optional(),
  priority:     z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
  assigneeName: z.string().optional(),
  dueDate:      z.string().datetime().optional(),
  sortOrder:    z.number().int().optional(),
});

export type UpsertDevelopmentBriefBody = z.infer<typeof upsertDevelopmentBriefSchema>;
export type DevTaskBody                = z.infer<typeof devTaskSchema>;
