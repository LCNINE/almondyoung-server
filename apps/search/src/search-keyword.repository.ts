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

export interface ZeroHitKeywordAggRow {
  keyword: string;
  keywordNorm: string;
  /** 기간 내 결과 0건 검색 횟수 */
  zeroCount: number;
  lastSearchedAt: string;
}

/** 전 기간 기준 키워드 활동 시각 — "N일 지연" 산출 재료 */
export interface KeywordActivity {
  /** 마지막으로 결과가 있었던(result_count>0) 검색 시각. 없으면 null */
  lastPositiveAt: string | null;
  firstZeroAt: string | null;
  lastZeroAt: string | null;
}

export interface KeywordDetailAggregation {
  /** 기간 내 검색 횟수 */
  count: number;
  /** 기간 내 결과 0건 횟수 */
  zeroCount: number;
  series: KeywordVolumeBucket[];
  /** 가장 최근 검색의 표시용 키워드 — 이력이 없으면 null */
  latestKeyword: string | null;
  lastSearchedAt: string | null;
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
  /** 기간 내 결과 0건 검색어 전체 (0건 횟수 내림차순, size 상한) */
  getZeroHitKeywords(options: {
    fromIso: string;
    toExclusiveIso: string;
    size: number;
  }): Promise<ZeroHitKeywordAggRow[]>;
  /** 주어진 keyword_norm 들의 전 기간 활동 시각 — 방치 일수 계산용 */
  getKeywordActivity(options: { keywordNorms: string[] }): Promise<Map<string, KeywordActivity>>;
  /** 단일 keyword_norm 의 기간 내 검색수·0건수·일별 추이 */
  getKeywordDetail(options: {
    keywordNorm: string;
    fromIso: string;
    toExclusiveIso: string;
  }): Promise<KeywordDetailAggregation>;
  /** 검색어를 부분 문자열로 품은 다른 검색어들 — "세제" → "세탁세제", "주방세제" */
  getRelatedKeywords(options: {
    compactKeyword: string;
    excludeNorm: string;
    size: number;
    lookbackDays: number;
  }): Promise<SuggestedKeyword[]>;
}

export const SEARCH_KEYWORD_REPOSITORY = 'SEARCH_KEYWORD_REPOSITORY';
