export class TrendingKeywordItemDto {
  keyword: string;
  count24h: number;
  lastSearchedAt: string;
}

export class TrendingKeywordsResponseDto {
  windowHours: number;
  items: TrendingKeywordItemDto[];
}

export class SearchSuggestionItemDto {
  keyword: string;
  count: number;
  lastSearchedAt: string;
  source: 'query_log';
}

export class SearchSuggestionsResponseDto {
  query: string;
  items: SearchSuggestionItemDto[];
}
