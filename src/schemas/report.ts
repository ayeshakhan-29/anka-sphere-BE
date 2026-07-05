import { z } from 'zod';

export const upsertReportSchema = z.object({
  type:        z.enum(['WEEKLY', 'MONTHLY']),
  period:      z.string().min(1),
  periodStart: z.string(), // ISO date
  status:      z.enum(['DRAFT', 'READY', 'SENT']).optional(),
  summary:     z.string().optional(),
  blockers:    z.string().optional(),
  highlights:  z.string().optional(),
  nextSteps:   z.string().optional(),
});

export const sendReportSchema = z.object({
  to: z.array(z.string().email()).min(1),
});

export type UpsertReportBody = z.infer<typeof upsertReportSchema>;
export type SendReportBody = z.infer<typeof sendReportSchema>;
