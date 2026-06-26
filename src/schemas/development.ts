import { z } from 'zod';

export const upsertDevelopmentBriefSchema = z.object({
  techStack:         z.string().optional(),
  repoUrl:           z.string().optional(),
  stagingUrl:        z.string().optional(),
  liveUrl:           z.string().optional(),
  notes:             z.string().optional(),
  performanceNotes:  z.string().optional(),
  backupLog:         z.any().optional(),
  uptimeStatus:      z.string().optional(),
  uptimeResponseTime: z.number().optional(),
});

export const devTaskSchema = z.object({
  title:        z.string().min(1),
  description:  z.string().optional(),
  status:       z.enum(['SETUP', 'IN_DEVELOPMENT', 'IN_QA', 'STAGING', 'LIVE', 'MAINTENANCE']),
  priority:     z.enum(['LOW', 'MEDIUM', 'HIGH']),
  assigneeName: z.string().optional(),
  dueDate:      z.string().datetime().optional(),
  sortOrder:    z.number().int(),
  pageId:       z.string().nullable().optional(),
});

export type UpsertDevelopmentBriefBody = z.infer<typeof upsertDevelopmentBriefSchema>;
export type DevTaskBody                = z.infer<typeof devTaskSchema>;

