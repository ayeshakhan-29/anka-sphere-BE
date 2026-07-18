import { z } from 'zod';

export const upsertAdAccountLinkSchema = z.object({
  network: z.enum(['GOOGLE', 'META']),
  externalAccountId: z.string().min(1).max(100),
  externalAccountName: z.string().max(200).nullish(),
  externalCampaignIds: z.array(z.string()).nullish(),
});

export type UpsertAdAccountLinkBody = z.infer<typeof upsertAdAccountLinkSchema>;
