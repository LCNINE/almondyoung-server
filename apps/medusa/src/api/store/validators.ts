import { z } from 'zod';

export const CreateCartSchema = z.object({
  region_id: z.string().optional(),
  customer_id: z.string().optional(),
  sales_channel_id: z.string().optional(),
  email: z.string().email().optional(),
  currency_code: z.string().optional(),
  items: z
    .array(
      z.object({
        variant_id: z.string(),
        quantity: z.number().int().positive(),
      }),
    )
    .optional(),
  shipping_address: z
    .object({
      first_name: z.string().optional(),
      last_name: z.string().optional(),
      address_1: z.string().optional(),
      address_2: z.string().optional(),
      city: z.string().optional(),
      country_code: z.string().optional(),
      province: z.string().optional(),
      postal_code: z.string().optional(),
      phone: z.string().optional(),
    })
    .optional(),
  billing_address: z
    .object({
      first_name: z.string().optional(),
      last_name: z.string().optional(),
      address_1: z.string().optional(),
      address_2: z.string().optional(),
      city: z.string().optional(),
      country_code: z.string().optional(),
      province: z.string().optional(),
      postal_code: z.string().optional(),
      phone: z.string().optional(),
    })
    .optional(),
  metadata: z.record(z.any()).optional(),
});
