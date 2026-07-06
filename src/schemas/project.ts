import { z } from 'zod';

export const createProjectSchema = z.object({
  name: z.string().min(1),
  clientName: z.string().min(1),
  description: z.string().optional(),
  startDate: z.string().datetime().optional(),
  targetDate: z.string().datetime().optional(),
  analyticsPropertyId: z.string().optional(),
  searchConsoleUrl: z.string().url().optional().or(z.literal('')),
});

export const updateProjectSchema = createProjectSchema.partial().extend({
  status: z.enum(['ACTIVE', 'ON_HOLD', 'COMPLETED', 'ARCHIVED']).optional(),
});

export const upsertProfilingSchema = z.object({
  companyName: z.string().optional(),
  industry: z.string().optional(),
  about: z.string().optional(),
  objectives: z.string().optional(),
  scope: z.string().optional(),
  budget: z.string().optional(),
  priority: z.string().optional(),
  brandVoice: z.string().optional(),
  tagline: z.string().optional(),
  brandColours: z.string().optional(),
  typography: z.string().optional(),
  brandRefs: z.string().optional(),
  brandDislikes: z.string().optional(),
  primaryKeywords: z.string().optional(),
  secondaryKeywords: z.string().optional(),
  existingDomain: z.string().optional(),
  localSeo: z.string().optional(),
  seoNotes: z.string().optional(),
});

export const personaSchema = z.object({
  name: z.string().min(1),
  ageRange: z.string().optional(),
  jobRole: z.string().optional(),
  painPoints: z.string().optional(),
  goals: z.string().optional(),
  sortOrder: z.number().int().optional(),
});

export const competitorSchema = z.object({
  name: z.string().min(1),
  websiteUrl: z.string().url().optional().or(z.literal('')),
  strength: z.string().optional(),
  weakness: z.string().optional(),
  sortOrder: z.number().int().optional(),
});

export const milestoneSchema = z.object({
  label: z.string().min(1),
  dueDate: z.string().datetime().optional(),
  status: z.enum(['PENDING', 'DONE']).optional(),
  sortOrder: z.number().int().optional(),
});

export type CreateProjectBody = z.infer<typeof createProjectSchema>;
export type UpdateProjectBody = z.infer<typeof updateProjectSchema>;
export type UpsertProfilingBody = z.infer<typeof upsertProfilingSchema>;
export type PersonaBody = z.infer<typeof personaSchema>;
export type CompetitorBody = z.infer<typeof competitorSchema>;
export type MilestoneBody = z.infer<typeof milestoneSchema>;
