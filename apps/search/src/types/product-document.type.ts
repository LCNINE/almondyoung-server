export const DEFAULT_PRODUCTS_INDEX = 'search_products';

export const PRODUCTS_INDEX_MAPPINGS = {
  properties: {
    master_id: { type: 'keyword' as const },
    version_id: { type: 'keyword' as const },
    name: {
      type: 'text' as const,
      fields: {
        keyword: { type: 'keyword' as const },
      },
    },
    name_compact: { type: 'keyword' as const },
    description: { type: 'text' as const },
    thumbnail: { type: 'keyword' as const },
    brand: {
      type: 'text' as const,
      fields: {
        keyword: { type: 'keyword' as const },
      },
    },
    category_ids: { type: 'keyword' as const },
    category_names: {
      type: 'text' as const,
      fields: {
        keyword: { type: 'keyword' as const },
      },
    },
    tags: {
      type: 'text' as const,
      fields: {
        keyword: { type: 'keyword' as const },
      },
    },
    min_base_price: { type: 'long' as const },
    max_base_price: { type: 'long' as const },
    min_membership_price: { type: 'long' as const },
    max_membership_price: { type: 'long' as const },
    status: { type: 'keyword' as const },
    changed_at: { type: 'date' as const },
    updated_at: { type: 'date' as const },
  },
} as const;

export interface SearchProductDocument {
  master_id: string;
  version_id: string;
  name: string;
  name_compact: string;
  description: string | null;
  thumbnail: string | null;
  brand: string | null;
  category_ids: string[];
  category_names: string[];
  tags: string[];
  min_base_price: number | null;
  max_base_price: number | null;
  min_membership_price: number | null;
  max_membership_price: number | null;
  status: string;
  changed_at: string;
  updated_at: string;
}
