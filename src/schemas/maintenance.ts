import { z } from 'zod';

export const backupSchema = z.object({
  note: z.string().optional(),
});

export const perfNoteSchema = z.object({
  message: z.string().min(1, 'Performance note is required'),
});

export const updateUptimeSchema = z.object({
  uptimeStatus: z.enum(['OPERATIONAL', 'DEGRADED', 'DOWN']),
});

export type BackupBody = z.infer<typeof backupSchema>;
export type PerfNoteBody = z.infer<typeof perfNoteSchema>;
export type UpdateUptimeBody = z.infer<typeof updateUptimeSchema>;
