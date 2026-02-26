import { Inject, Injectable } from '@nestjs/common';
import {
  SearchSuggestionsResponseDto,
  TrendingKeywordsResponseDto,
} from './dto/search-keyword-response.dto';
import {
  SEARCH_KEYWORD_REPOSITORY,
  SearchKeywordRepository,
} from './search-keyword.repository';
import { compactText } from './utils/text.utils';

@Injectable()
export class SearchKeywordService {
  private readonly defaultWindowHours = 24;
  private readonly defaultLookbackDays = 30;

  constructor(
    @Inject(SEARCH_KEYWORD_REPOSITORY)
    private readonly repository: SearchKeywordRepository,
  ) {}

  async recordSearchKeyword(
    rawKeyword: string,
    resultCount: number,
  ): Promise<void> {
    const keyword = this.normalizeDisplayKeyword(rawKeyword);

    if (!keyword) {
      return;
    }

    const keywordNorm = this.normalizeKeyword(keyword);
    const keywordCompact = compactText(keywordNorm);

    await this.repository.record({
      keyword,
      keywordNorm,
      keywordCompact,
      searchedAt: new Date().toISOString(),
      resultCount,
    });
  }

  async getTrendingKeywords(size: number): Promise<TrendingKeywordsResponseDto> {
    const rows = await this.repository.getTrendingKeywords({
      size,
      windowHours: this.defaultWindowHours,
    });

    return {
      windowHours: this.defaultWindowHours,
      items: rows.map((row) => ({
        keyword: row.keyword,
        count24h: row.count,
        lastSearchedAt: row.lastSearchedAt,
      })),
    };
  }

  async suggestKeywords(
    rawQuery: string,
    size: number,
  ): Promise<SearchSuggestionsResponseDto> {
    const query = this.normalizeDisplayKeyword(rawQuery);
    const prefix = this.normalizeKeyword(rawQuery);

    if (!prefix) {
      return {
        query,
        items: [],
      };
    }

    const rows = await this.repository.getSuggestions({
      prefix,
      compactPrefix: compactText(prefix),
      size,
      lookbackDays: this.defaultLookbackDays,
    });

    return {
      query,
      items: rows.map((row) => ({
        keyword: row.keyword,
        count: row.count,
        lastSearchedAt: row.lastSearchedAt,
        source: 'query_log' as const,
      })),
    };
  }

  private normalizeDisplayKeyword(value: string): string {
    return value.trim().replace(/\s+/g, ' ');
  }

  private normalizeKeyword(value: string): string {
    const normalized = value.trim().replace(/\s+/g, ' ').toLowerCase();
    return normalized.length > 0 ? normalized : '';
  }
}
