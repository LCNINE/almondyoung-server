export const PIM_PRODUCTS_INDEX = 'pim_products';

export const PIM_PRODUCTS_MAPPINGS = {
  properties: {
    master_id: { type: 'keyword' as const },
    product_id: { type: 'keyword' as const },
    version_id: { type: 'keyword' as const },
    name: {
      type: 'text' as const,
      analyzer: 'standard',
      fields: {
        keyword: { type: 'keyword' as const },
      },
    },
    description: { type: 'text' as const },
    product_code: { type: 'keyword' as const },
    brand: { type: 'keyword' as const },
    status: { type: 'keyword' as const },
    approval_status: { type: 'keyword' as const },
    price: { type: 'long' as const },
    category_id: { type: 'keyword' as const },
    category_name: { type: 'keyword' as const },
    category_path: { type: 'text' as const },
    tags: {
      type: 'nested' as const,
      properties: {
        group_id: { type: 'keyword' as const },
        group_name: { type: 'keyword' as const },
        value_id: { type: 'keyword' as const },
        value_name: { type: 'keyword' as const },
      },
    },
    tag_value_ids: { type: 'keyword' as const },
    created_at: { type: 'date' as const },
    updated_at: { type: 'date' as const },
  },
} as const;

export interface ElasticsearchProductDocument {
  master_id: string;
  product_id: string;
  version_id: string;
  name: string;
  description: string | null;
  product_code: string | null;
  brand: string | null;
  status: string;
  approval_status: string | null;
  price: number | null;
  category_id: string | null;
  category_name: string | null;
  category_path: string | null;
  tags: Array<{
    group_id: string;
    group_name: string;
    value_id: string;
    value_name: string;
  }>;
  tag_value_ids: string[];
  created_at: string;
  updated_at: string;
}

