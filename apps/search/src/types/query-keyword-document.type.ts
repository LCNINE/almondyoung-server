export const DEFAULT_QUERY_EVENTS_INDEX = 'search_query_events';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const QUERY_EVENTS_INDEX_SETTINGS: Record<string, any> = {
  number_of_shards: 1,
  number_of_replicas: 1,
};

export const QUERY_EVENTS_INDEX_MAPPINGS = {
  properties: {
    keyword: { type: 'keyword' as const },
    keyword_norm: { type: 'keyword' as const },
    keyword_compact: { type: 'keyword' as const },
    searched_at: { type: 'date' as const },
    result_count: { type: 'integer' as const },
  },
} as const;

export interface SearchQueryEventDocument {
  keyword: string;
  keyword_norm: string;
  keyword_compact: string;
  searched_at: string;
  result_count: number;
}
