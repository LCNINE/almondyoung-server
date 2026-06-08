export const DEFAULT_PRODUCTS_INDEX = 'search_products';

export const PRODUCT_SEARCH_SYNONYMS: string[] = [
  '전처리,프라이머',
  '글루,접착제',
  '리무버,제거제',
  '브러시,브러쉬',
  '롯드,로드,롯뜨,로뜨,롣드,롣뜨',
  '1회용,일회용',
  '가모,래쉬',
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const PRODUCTS_INDEX_SETTINGS: Record<string, any> = {
  number_of_shards: 1,
  number_of_replicas: 1,
  analysis: {
    tokenizer: {
      nori_tokenizer: {
        type: 'nori_tokenizer' as const,
        decompound_mode: 'discard' as const,
        discard_punctuation: true,
      },
    },
    filter: {
      nori_posfilter: {
        type: 'nori_part_of_speech' as const,
        stoptags: ['E', 'IC', 'J', 'MM', 'SP', 'SSC', 'SSO', 'SC', 'SE', 'XPN', 'XSA', 'XSN', 'XSV', 'VSV'],
      },
      edge_ngram: {
        type: 'edge_ngram' as const,
        min_gram: 1,
        max_gram: 15,
      },
      search_synonym_graph: {
        type: 'synonym_graph' as const,
        synonyms: PRODUCT_SEARCH_SYNONYMS,
        lenient: true,
      },
    },
    analyzer: {
      nori: {
        type: 'custom' as const,
        tokenizer: 'nori_tokenizer' as const,
        filter: ['nori_posfilter', 'lowercase'],
      },
      nori_search_synonym: {
        type: 'custom' as const,
        tokenizer: 'nori_tokenizer' as const,
        filter: ['lowercase', 'search_synonym_graph', 'nori_posfilter'],
      },
      standard_lowercase: {
        type: 'custom' as const,
        tokenizer: 'standard' as const,
        filter: ['lowercase'],
      },
      edge_ngram_analyzer: {
        type: 'custom' as const,
        tokenizer: 'standard' as const,
        filter: ['lowercase', 'edge_ngram'],
      },
    },
  },
};

export const PRODUCTS_INDEX_MAPPINGS = {
  properties: {
    master_id: { type: 'keyword' as const },
    version_id: { type: 'keyword' as const },
    name: {
      type: 'text' as const,
      analyzer: 'nori',
      fields: {
        keyword: { type: 'keyword' as const },
        standard: {
          type: 'text' as const,
          analyzer: 'standard_lowercase',
        },
        ngram: {
          type: 'text' as const,
          analyzer: 'edge_ngram_analyzer',
          search_analyzer: 'standard_lowercase',
        },
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
    review_count: { type: 'integer' as const },
    average_rating: { type: 'float' as const },
    bayesian_review_score: { type: 'float' as const },
    review_sort_score: { type: 'float' as const },
    review_stats_updated_at: { type: 'date' as const },
  },
} as const;

export const REVIEW_FIELDS_MAPPINGS = {
  properties: {
    review_count: { type: 'integer' as const },
    average_rating: { type: 'float' as const },
    bayesian_review_score: { type: 'float' as const },
    review_sort_score: { type: 'float' as const },
    review_stats_updated_at: { type: 'date' as const },
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
  review_count?: number;
  average_rating?: number;
  bayesian_review_score?: number;
  review_sort_score?: number;
  review_stats_updated_at?: string | null;
}

export interface ReviewStatsUpdateFields {
  review_count: number;
  average_rating: number;
  bayesian_review_score: number;
  review_sort_score?: number;
  review_stats_updated_at: string;
}
