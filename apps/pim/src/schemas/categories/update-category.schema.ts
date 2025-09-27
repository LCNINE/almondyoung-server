import { z } from 'zod';

export const UpdateCategorySchema = z.object({
  name: z
    .string()
    .min(1, 'Name is required')
    .max(255, 'Name must be less than 255 characters')
    .optional(),
  description: z.string().optional(),
  slug: z.string().optional(),
  sortOrder: z.number().optional(),
  isActive: z.boolean().optional(),
});

export type UpdateCategoryDto = z.infer<typeof UpdateCategorySchema>;
