import { z } from 'zod';

const AddressSchema = z.object({
  customer_id: z.string().optional(),
  company: z.string().optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  address_1: z.string().optional(),
  address_2: z.string().optional(),
  city: z.string().optional(),
  country_code: z.string().optional(),
  province: z.string().optional(),
  postal_code: z.string().optional(),
  phone: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const LineItemSchema = z.object({
  title: z.string(),
  subtitle: z.string().optional(),
  thumbnail: z.string().optional(),
  cart_id: z.string().optional(),
  quantity: z.number(),
  product_id: z.string().optional(),
  product_title: z.string().optional(),
  product_description: z.string().optional(),
  product_subtitle: z.string().optional(),
  product_type: z.string().optional(),
  product_type_id: z.string().optional(),
  product_collection: z.string().optional(),
  product_handle: z.string().optional(),
  variant_id: z.string().optional(),
  variant_sku: z.string().optional(),
  variant_barcode: z.string().optional(),
  variant_title: z.string().optional(),
  variant_option_values: z.record(z.unknown()).optional(),
  requires_shipping: z.boolean().optional(),
  is_discountable: z.boolean().optional(),
  is_tax_inclusive: z.boolean().optional(),
  is_custom_price: z.boolean().optional(),
  compare_at_unit_price: z.number().optional(),
  unit_price: z.number(),
  metadata: z.record(z.unknown()).optional().nullable(),
});

export const CreateCartSchema = z
  .object({
    region_id: z.string().optional(),
    customer_id: z.string().optional(),
    sales_channel_id: z.string().optional(),
    email: z.string().optional(),
    currency_code: z.string().optional(),
    shipping_address_id: z.string().optional(),
    billing_address_id: z.string().optional(),
    shipping_address: z.union([AddressSchema, z.string()]).optional(),
    billing_address: z.union([AddressSchema, z.string()]).optional(),
    metadata: z.record(z.unknown()).optional(),
    items: z.array(LineItemSchema).optional(),
  })
  .strict();

export type CreateCartType = z.infer<typeof CreateCartSchema>;
