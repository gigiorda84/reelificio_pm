import { z } from 'zod';

export const pageInputSchema = z.object({
  name: z.string().min(1).max(120),
  slug: z
    .string()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug_format'),
  code_prefix: z
    .string()
    .length(2)
    .regex(/^[A-Z]{2}$/, 'code_prefix_format'),
  description: z.string().max(500).optional().nullable(),
  buffer_threshold: z.coerce.number().int().min(0).max(50).default(3),
  active: z.coerce.boolean().default(true),
});

export type PageInput = z.infer<typeof pageInputSchema>;
