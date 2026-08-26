export interface SearchKeywordRecord {
  keyword: string;
  keywordNorm: string;
  keywordCompact: string;
  searchedAt: string;
  resultCount: number;
}

export interface TrendingKeyword {
  keyword: string;
  keywordNorm: string;
  count: number;
  lastSearchedAt: string;
}

export interface SuggestedKeyword {
  keyword: string;
  keywordNorm: string;
  count: number;
  lastSearchedAt: string;
}

export interface KeywordVolumeBucket {
  /** KST 달력 날짜 (YYYY-MM-DD) */
  bucket: string;
  count: number;
  zeroCount: number;
}

export interface KeywordStatRow {
  keyword: string;
  keywordNorm: string;
  count: number;
  /** 이 키워드 검색 중 결과 0건이었던 횟수 */
  zeroCount: number;
  lastSearchedAt: string;
}

export interface KeywordStatisticsAggregation {
  totalSearches: number;
  zeroResultSearches: number;
  series: KeywordVolumeBucket[];
  /** keyword_norm 기준 검색 횟수 내림차순 — 급상승 산출용으로 size 보다 넉넉히 담긴다 */
  top: KeywordStatRow[];
  /** 결과 0건 검색만 따로 집계한 순위 */
  zeroTop: KeywordStatRow[];
}

export interface SearchKeywordRepository {
  record(record: SearchKeywordRecord): Promise<void>;
  getTrendingKeywords(options: { size: number; windowHours: number }): Promise<TrendingKeyword[]>;
  getSuggestions(options: {
    prefix: string;
    compactPrefix: string;
    size: number;
    lookbackDays: number;
  }): Promise<SuggestedKeyword[]>;
  getKeywordStatistics(options: {
    /** 포함 하한 (ISO instant) */
    fromIso: string;
    /** 배타 상한 (ISO instant) */
    toExclusiveIso: string;
    size: number;
  }): Promise<KeywordStatisticsAggregation>;
  /** 주어진 keyword_norm 들의 기간 내 검색 횟수 — 전기간 대비 산출용 */
  getKeywordCounts(options: {
    fromIso: string;
    toExclusiveIso: string;
    keywordNorms: string[];
  }): Promise<Map<string, number>>;
  /** 검색어를 부분 문자열로 품은 다른 검색어들 — "세제" → "세탁세제", "주방세제" */
  getRelatedKeywords(options: {
    compactKeyword: string;
    excludeNorm: string;
    size: number;
    lookbackDays: number;
  }): Promise<SuggestedKeyword[]>;
}

export const SEARCH_KEYWORD_REPOSITORY = 'SEARCH_KEYWORD_REPOSITORY';
