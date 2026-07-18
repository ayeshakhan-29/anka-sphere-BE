import { z } from 'zod';

/** Providers accepted by POST /integrations/:provider/disconnect (URL slug form). */
export const disconnectProviderSchema = z.enum(['google', 'meta', 'tiktok']);

export const oauthCallbackQuerySchema = z.object({
  code: z.string().min(1).optional(),
  state: z.string().min(1),
  error: z.string().optional(),
  error_description: z.string().optional(),
});

export type DisconnectProvider = z.infer<typeof disconnectProviderSchema>;
export type OAuthCallbackQuery = z.infer<typeof oauthCallbackQuerySchema>;
