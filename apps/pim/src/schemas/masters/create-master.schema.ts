import { z } from 'zod';

export const CreateMasterSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  brand: z.string().max(100).optional(),
  categoryId: z.string().uuid().optional(),
  basePrice: z.number().int().min(0),
  pricingStrategy: z.enum(['option_based', 'variant_based']),
  tags: z.array(z.string()).optional(),
  images: z.array(z.string().url()).optional(),
  attributes: z.record(z.string(), z.any()).optional(),
  seoTitle: z.string().max(255).optional(),
  seoDescription: z.string().optional(),
  seoKeywords: z.array(z.string()).optional(),
  
  optionGroups: z.array(z.object({
    name: z.string().min(1).max(100),
    displayName: z.string().min(1).max(100),
    sortOrder: z.number().int().min(0).optional(),
    values: z.array(z.object({
      value: z.string().min(1).max(100),
      displayName: z.string().min(1).max(100),
      sortOrder: z.number().int().min(0).optional(),
      price: z.number().int().min(0).optional()
    })).min(1)
  })).optional(),
  
  variantPrices: z.record(z.string(), z.number().int().min(0)).optional()
});

export type CreateMasterDto = z.infer<typeof CreateMasterSchema>; 