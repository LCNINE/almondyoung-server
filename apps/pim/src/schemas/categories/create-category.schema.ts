import { z } from 'zod';

export const CreateCategorySchema = z.object({
  name: z
    .string()
    .min(1, 'Name is required')
    .max(255, 'Name must be less than 255 characters'),
  description: z.string().optional(),
  slug: z.string().optional(),
  parentId: z.string().uuid('Parent ID must be a valid UUID').optional(),
  sortOrder: z.number().optional(),
});

export type CreateCategoryDto = z.infer<typeof CreateCategorySchema>;
