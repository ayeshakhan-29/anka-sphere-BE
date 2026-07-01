import { z } from 'zod';

export const wpConnectionSchema = z.object({
  env: z.enum(['DEV', 'STAGING', 'PRODUCTION']),
  siteUrl: z.string().url(),
  wpUsername: z.string().min(1),
  wpAppPassword: z.string().min(1),
  notes: z.string().optional(),
});

export const wpConnectionUpdateSchema = z.object({
  siteUrl: z.string().url().optional(),
  wpUsername: z.string().min(1).optional(),
  wpAppPassword: z.string().min(1).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  notes: z.string().optional(),
});

export const deploymentQueueItemSchema = z.object({
  contentKind: z.enum(['PAGE', 'POST']),
  pageId: z.string().optional(),
  postId: z.string().optional(),
  title: z.string().min(1),
  slug: z.string().optional(),
  targetEnv: z.enum(['DEV', 'STAGING', 'PRODUCTION']).default('STAGING'),
});

export const deploymentQueueUpdateSchema = z.object({
  title: z.string().min(1).optional(),
  slug: z.string().optional(),
  targetEnv: z.enum(['DEV', 'STAGING', 'PRODUCTION']).optional(),
  qaStatus: z.enum(['NOT_STARTED', 'PASS', 'FAIL']).optional(),
  qaNotes: z.string().optional(),
  qaChecklist: z.record(z.string(), z.boolean()).optional(),
});

export const deployRequestSchema = z.object({
  queueItemId: z.string(),
  targetEnv: z.enum(['DEV', 'STAGING', 'PRODUCTION']),
  confirmProduction: z.boolean().default(false),
});

export const qaUpdateSchema = z.object({
  qaStatus: z.enum(['NOT_STARTED', 'PASS', 'FAIL']),
  qaNotes: z.string().optional(),
  qaChecklist: z.record(z.string(), z.boolean()).optional(),
});

export const wpPluginSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  version: z.string().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).default('INACTIVE'),
  description: z.string().optional(),
});

export const wpThemeSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  version: z.string().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).default('INACTIVE'),
  description: z.string().optional(),
});

export type WpConnectionBody = z.infer<typeof wpConnectionSchema>;
export type WpConnectionUpdateBody = z.infer<typeof wpConnectionUpdateSchema>;
export type DeploymentQueueItemBody = z.infer<typeof deploymentQueueItemSchema>;
export type DeploymentQueueUpdateBody = z.infer<typeof deploymentQueueUpdateSchema>;
export type DeployRequestBody = z.infer<typeof deployRequestSchema>;
export type QaUpdateBody = z.infer<typeof qaUpdateSchema>;
export type WpPluginBody = z.infer<typeof wpPluginSchema>;
export type WpThemeBody = z.infer<typeof wpThemeSchema>;
