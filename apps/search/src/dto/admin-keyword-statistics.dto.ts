import { IsCalendarDateConstraint } from '@app/shared';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min, Validate } from 'class-validator';

export class AdminKeywordStatisticsQueryDto {
  // 모양만 보는 @Matches 는 '2026-02-31' 을 통과시키고, 그 값은
  // kstDayStartIso 의 toISOString() 에서 RangeError(500)로 터진다.
  @Validate(IsCalendarDateConstraint, { message: 'from 은 달력에 존재하는 YYYY-MM-DD 여야 합니다' })
  from: string;

  @Validate(IsCalendarDateConstraint, { message: 'to 는 달력에 존재하는 YYYY-MM-DD 여야 합니다' })
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
