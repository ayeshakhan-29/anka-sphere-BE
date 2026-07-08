import { z } from 'zod';

export const emailProviderSchema = z.enum(['RESEND', 'POSTMARK', 'SENDGRID', 'MAILGUN', 'CUSTOM_SMTP']);

const domainPattern = /^(?!-)(?:[a-z0-9-]{1,63}\.)+[a-z]{2,63}$/;
const localPartPattern = /^[a-z0-9][a-z0-9._+-]{0,62}$/;

export const upsertEmailDeliverySchema = z.object({
  provider: emailProviderSchema.default('RESEND'),
  domain: z.string()
    .trim()
    .toLowerCase()
    .transform((value) => value.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, ''))
    .refine((value) => domainPattern.test(value), 'Enter a valid domain, for example anka.agency.'),
  fromName: z.string().trim().min(2).max(80),
  fromLocalPart: z.string().trim().toLowerCase().regex(localPartPattern, 'Use a valid email prefix, for example reports.'),
  replyToEmail: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().email().optional(),
  ),
});

export const markEmailDeliveryConfiguredSchema = z.object({
  configured: z.literal(true),
});

export type UpsertEmailDeliveryBody = z.infer<typeof upsertEmailDeliverySchema>;
export type MarkEmailDeliveryConfiguredBody = z.infer<typeof markEmailDeliveryConfiguredSchema>;