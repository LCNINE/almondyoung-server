import { Inject, Injectable } from '@nestjs/common';
import { AdminKeywordStatisticsResponseDto } from './dto/admin-keyword-statistics.dto';
import { SearchSuggestionsResponseDto, TrendingKeywordsResponseDto } from './dto/search-keyword-response.dto';
import { SEARCH_KEYWORD_REPOSITORY, SearchKeywordRepository } from './search-keyword.repository';
import { compactText } from './utils/text.utils';

/** KST 달력 날짜(YYYY-MM-DD)의 자정을 ISO instant 로 — searched_at 은 UTC instant 로 저장된다. */
function kstDayStartIso(dateOnly: string): string {
  return new Date(`${dateOnly}T00:00:00+09:00`).toISOString();
}

/** 날짜 문자열 산술은 KST 오프셋과 무관하다 — 달력 날짜끼리의 덧뺄셈은 UTC 기준으로 해도 같다. */
function addDays(dateOnly: string, days: number): string {
  const base = new Date(`${dateOnly}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

/** 직전 동일 길이 기간 — [from-len, from-1] */
export function previousRange(from: string, to: string): { from: string; to: string } {
  const lengthDays =
    Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
  return { from: addDays(from, -lengthDays), to: addDays(from, -1) };
}

/** 급상승 후보 최소 검색 횟수 — 1~2건짜리 노이즈가 무한 성장률로 상위를 덮는 것을 막는다 */
const RISING_MIN_COUNT = 3;

@Injectable()
export class SearchKeywordService {
  private readonly defaultWindowHours = 24;
  private readonly defaultLookbackDays = 30;

  constructor(
    @Inject(SEARCH_KEYWORD_REPOSITORY)
    private readonly repository: SearchKeywordRepository,
  ) {}

  async recordSearchKeyword(rawKeyword: string, resultCount: number): Promise<void> {
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

  async suggestKeywords(rawQuery: string, size: number): Promise<SearchSuggestionsResponseDto> {
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

  async getKeywordStatistics(from: string, to: string, limit: number): Promise<AdminKeywordStatisticsResponseDto> {
    const prev = previousRange(from, to);
    const fromIso = kstDayStartIso(from);
    const toExclusiveIso = kstDayStartIso(addDays(to, 1));

    const agg = await this.repository.getKeywordStatistics({ fromIso, toExclusiveIso, size: limit });

    const previousCounts = await this.repository.getKeywordCounts({
      fromIso: kstDayStartIso(prev.from),
      toExclusiveIso: kstDayStartIso(addDays(prev.to, 1)),
      keywordNorms: agg.top.map((row) => row.keywordNorm),
    });

    const withPrevious = agg.top.map((row) => ({
      ...row,
      previousCount: previousCounts.get(row.keywordNorm) ?? 0,
    }));

    const rising = withPrevious
      .filter((row) => row.count >= RISING_MIN_COUNT && row.count > row.previousCount)
      .sort((a, b) => {
        const growthA = a.previousCount > 0 ? a.count / a.previousCount : Number.POSITIVE_INFINITY;
        const growthB = b.previousCount > 0 ? b.count / b.previousCount : Number.POSITIVE_INFINITY;
        if (growthB !== growthA) return growthB - growthA;
        return b.count - a.count;
      })
      .slice(0, limit);

    return {
      range: { from, to },
      previousRange: prev,
      totalSearches: agg.totalSearches,
      zeroResultSearches: agg.zeroResultSearches,
      series: agg.series,
      top: withPrevious.slice(0, limit),
      zeroTop: agg.zeroTop.map((row) => ({
        keyword: row.keyword,
        keywordNorm: row.keywordNorm,
        count: row.count,
        lastSearchedAt: row.lastSearchedAt,
      })),
      rising,
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
