export const DEFAULT_PRODUCTS_INDEX = 'search_products';

export const PRODUCTS_INDEX_SETTINGS = {
  number_of_shards: 1,
  number_of_replicas: 1,
  analysis: {
    tokenizer: {
      nori_tokenizer: {
        type: 'nori_tokenizer',
        decompound_mode: 'mixed',
        discard_punctuation: true,
      },
    },
    filter: {
      nori_posfilter: {
        type: 'nori_part_of_speech',
        stoptags: ['E', 'IC', 'J', 'MAG', 'MM', 'SP', 'SSC', 'SSO', 'SC', 'SE', 'XPN', 'XSA', 'XSN', 'XSV', 'UNA', 'NA', 'VSV'],
      },
    },
    analyzer: {
      nori: {
        type: 'custom',
        tokenizer: 'nori_tokenizer',
        filter: ['nori_posfilter', 'lowercase'],
      },
    },
  },
} as const;

export const PRODUCTS_INDEX_MAPPINGS = {
  properties: {
    master_id: { type: 'keyword' as const },
    version_id: { type: 'keyword' as const },
    name: {
      type: 'text' as const,
      analyzer: 'nori',
      fields: {
        keyword: { type: 'keyword' as const },
      },
    },
    name_compact: { type: 'keyword' as const },
    description: { type: 'text' as const, analyzer: 'nori' },
    thumbnail: { type: 'keyword' as const },
    brand: {
      type: 'text' as const,
      analyzer: 'nori',
      fields: {
        keyword: { type: 'keyword' as const },
      },
    },
    category_ids: { type: 'keyword' as const },
    category_names: {
      type: 'text' as const,
      analyzer: 'nori',
      fields: {
        keyword: { type: 'keyword' as const },
      },
    },
    tags: {
      type: 'text' as const,
      analyzer: 'nori',
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
