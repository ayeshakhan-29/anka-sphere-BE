import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1),
  role: z
    .enum([
      'ADMIN',
      'MANAGER_PRODUCT_MODELLING',
      'MANAGER_PRODUCT_DEVELOPMENT',
      'MANAGER_PRODUCT_GROWTH',
      'CONTENT_WRITER',
      'DESIGNER',
      'DEVELOPER',
      'SOCIAL_MEDIA',
      'PAID_ADS',
      'SEO',
    ])
    .optional(),
});

export type LoginBody = z.infer<typeof loginSchema>;
export type RegisterBody = z.infer<typeof registerSchema>;
