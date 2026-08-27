export const DEFAULT_PRODUCTS_INDEX = 'search_products';

// 검색 시점에만 적용된다(nori_search_synonym). 바꾼 뒤에는 인덱스 settings 갱신이 필요하고,
// 색인 토큰은 그대로라 재색인은 필요 없다.
//
// nori 가 양쪽을 같은 토큰으로 잘라줘야 먹는다 — "점도제"(→ 점/도조/절제)처럼 조각이 어긋나면
// minimum_should_match 를 못 채워 동의어를 넣어도 0건이다. 새 줄을 추가할 때는 _analyze 로
// 검색어와 상품명의 토큰이 겹치는지 먼저 확인할 것.
export const PRODUCT_SEARCH_SYNONYMS: string[] = [
  '전처리,프라이머',
  '글루,접착제',
  '리무버,제거제',
  '브러시,브러쉬',
  '롯드,로드,롯뜨,로뜨,롣드,롣뜨',
  '1회용,일회용',
  '가모,래쉬',
  '알콜,알코올,에탄올,ethanol,alcohol',
  '젬소,잼소,젬스톤',
  '색소통,잉크통',
  '생장제,영양제',
];

// 공백 지운 상품명의 부분 문자열 검색용. 검색어가 MAX 보다 길면 매칭 안 되니 쿼리에서 거른다.
export const COMPACT_NGRAM_MIN = 2;
export const COMPACT_NGRAM_MAX = 12;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const PRODUCTS_INDEX_SETTINGS: Record<string, any> = {
  number_of_shards: 1,
  number_of_replicas: 1,
  // 기본값 1 이면 인덱스 생성이 거부된다.
  max_ngram_diff: COMPACT_NGRAM_MAX - COMPACT_NGRAM_MIN,
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
      compact_ngram: {
        type: 'ngram' as const,
        min_gram: COMPACT_NGRAM_MIN,
        max_gram: COMPACT_NGRAM_MAX,
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
      // "살롱지은드림롯드" 안의 "드림롯드" 를 찾는다. tokenizer keyword 라야 공백 제거가 유지된다.
      compact_ngram_index: {
        type: 'custom' as const,
        tokenizer: 'keyword' as const,
        filter: ['lowercase', 'compact_ngram'],
      },
      // 검색어를 쪼개면 2글자 조각이 인덱스 전체와 매칭돼 노이즈가 터진다.
      compact_ngram_search: {
        type: 'custom' as const,
        tokenizer: 'keyword' as const,
        filter: ['lowercase'],
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
    name_compact: {
      type: 'keyword' as const,
      fields: {
        ngram: {
          type: 'text' as const,
          analyzer: 'compact_ngram_index',
          search_analyzer: 'compact_ngram_search',
        },
      },
    },
    description: { type: 'text' as const, analyzer: 'nori' },
    thumbnail: { type: 'keyword' as const },
    brand: {
      type: 'text' as const,
      analyzer: 'nori',
      fields: {
        keyword: { type: 'keyword' as const },
      },
    },
    name_jamo: { type: 'text' as const, analyzer: 'whitespace' as const },
    brand_jamo: { type: 'text' as const, analyzer: 'whitespace' as const },
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
    seo_keywords: {
      type: 'text' as const,
      analyzer: 'nori',
      fields: {
        standard: {
          type: 'text' as const,
          analyzer: 'standard_lowercase',
        },
      },
    },
    min_base_price: { type: 'long' as const },
    max_base_price: { type: 'long' as const },
    min_membership_price: { type: 'long' as const },
    max_membership_price: { type: 'long' as const },
    status: { type: 'keyword' as const },
    is_visible_to_members_only: { type: 'boolean' as const },
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

// 기존 인덱스에 additive 로 putMapping 하기 위한 필드 (멤버십 전용 노출)
export const MEMBERS_ONLY_FIELD_MAPPINGS = {
  properties: {
    is_visible_to_members_only: { type: 'boolean' as const },
  },
} as const;

// 오타 내성용. nori 를 태우면 자모가 깨지므로 whitespace 로만 자른다.
export const JAMO_FIELDS_MAPPINGS = {
  properties: {
    name_jamo: { type: 'text' as const, analyzer: 'whitespace' as const },
    brand_jamo: { type: 'text' as const, analyzer: 'whitespace' as const },
  },
} as const;

// 어드민 SEO 키워드 칸. nori 가 브랜드명을 뭉개므로 standard 서브필드를 같이 둔다.
export const SEO_FIELDS_MAPPINGS = {
  properties: {
    seo_keywords: {
      type: 'text' as const,
      analyzer: 'nori' as const,
      fields: {
        standard: {
          type: 'text' as const,
          analyzer: 'standard_lowercase' as const,
        },
      },
    },
  },
} as const;

export interface SearchProductDocument {
  master_id: string;
  version_id: string;
  name: string;
  name_compact: string;
  name_jamo: string;
  brand_jamo: string;
  description: string | null;
  thumbnail: string | null;
  brand: string | null;
  category_ids: string[];
  category_names: string[];
  tags: string[];
  seo_keywords: string;
  min_base_price: number | null;
  max_base_price: number | null;
  min_membership_price: number | null;
  max_membership_price: number | null;
  status: string;
  is_visible_to_members_only: boolean;
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
