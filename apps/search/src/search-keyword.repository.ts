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

export interface SearchKeywordRepository {
  record(record: SearchKeywordRecord): Promise<void>;
  getTrendingKeywords(options: {
    size: number;
    windowHours: number;
  }): Promise<TrendingKeyword[]>;
  getSuggestions(options: {
    prefix: string;
    compactPrefix: string;
    size: number;
    lookbackDays: number;
  }): Promise<SuggestedKeyword[]>;
}

export const SEARCH_KEYWORD_REPOSITORY = 'SEARCH_KEYWORD_REPOSITORY';
