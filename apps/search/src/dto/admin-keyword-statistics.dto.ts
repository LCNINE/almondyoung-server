import { Type } from 'class-transformer';
import { IsInt, IsOptional, Matches, Max, Min } from 'class-validator';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export class AdminKeywordStatisticsQueryDto {
  @Matches(DATE_ONLY, { message: 'from 은 YYYY-MM-DD 형식이어야 합니다' })
  from: string;

  @Matches(DATE_ONLY, { message: 'to 는 YYYY-MM-DD 형식이어야 합니다' })
  to: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit: number = 20;
}

export class KeywordVolumeBucketDto {
  /** KST 달력 날짜 (YYYY-MM-DD) */
  bucket: string;
  count: number;
  zeroCount: number;
}

export class TopKeywordDto {
  keyword: string;
  keywordNorm: string;
  count: number;
  /** 이 키워드 검색 중 결과 0건이었던 횟수 */
  zeroCount: number;
  lastSearchedAt: string;
  /** 직전 동일 길이 기간의 검색 횟수 */
  previousCount: number;
}

export class ZeroResultKeywordDto {
  keyword: string;
  keywordNorm: string;
  count: number;
  lastSearchedAt: string;
}

export class DateRangeDto {
  from: string;
  to: string;
}

export class AdminKeywordStatisticsResponseDto {
  range: DateRangeDto;
  previousRange: DateRangeDto;
  totalSearches: number;
  zeroResultSearches: number;
  series: KeywordVolumeBucketDto[];
  top: TopKeywordDto[];
  /** 결과 0건 검색어 순위 — 수요는 있는데 상품이 없는 키워드 */
  zeroTop: ZeroResultKeywordDto[];
  /** 전기간 대비 검색량 급상승 키워드 (성장률 내림차순) */
  rising: TopKeywordDto[];
}
