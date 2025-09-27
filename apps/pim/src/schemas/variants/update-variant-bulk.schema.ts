import { z } from 'zod';

export const UpdateVariantBulkSchema = z.object({
  variantIds: z.array(z.string().uuid()).min(1),
  updates: z.object({
    status: z.enum(['active', 'inactive']).optional(),
    displayOrder: z.number().int().min(0).optional(),
    images: z.array(z.string().url()).optional(),
  })
});

export type UpdateVariantBulkDto = z.infer<typeof UpdateVariantBulkSchema>; 