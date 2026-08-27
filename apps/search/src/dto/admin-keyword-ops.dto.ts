import { IsCalendarDateConstraint } from '@app/shared';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min, Validate, ValidateIf } from 'class-validator';
import { DateRangeDto, KeywordVolumeBucketDto } from './admin-keyword-statistics.dto';

export const KEYWORD_ISSUE_STATUSES = ['new', 'dev', 'md', 'in_progress', 'resolved', 'ignored'] as const;
export type KeywordIssueStatus = (typeof KEYWORD_ISSUE_STATUSES)[number];

/** 0건 검색어의 자동 원인 분류 — 수동 상태(status)가 항상 우선한다 */
export type KeywordAutoCause = 'engine' | 'sourcing' | 'unclassified';

export class AdminZeroHitKeywordsQueryDto {
  @Validate(IsCalendarDateConstraint, { message: 'from 은 달력에 존재하는 YYYY-MM-DD 여야 합니다' })
  from: string;

  @Validate(IsCalendarDateConstraint, { message: 'to 는 달력에 존재하는 YYYY-MM-DD 여야 합니다' })
  to: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page: number = 1;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit: number = 20;
}

export class KeywordIssueDto {
  keywordNorm: string;
  keyword: string;
  status: KeywordIssueStatus;
  assigneeId: string | null;
  assigneeName: string | null;
  memo: string | null;
  updatedAt: string;
}

export class ZeroHitKeywordRowDto {
  keyword: string;
  keywordNorm: string;
  /** 기간 내 결과 0건 검색 횟수 */
  zeroCount: number;
  lastSearchedAt: string;
  /** 전 기간에서 마지막으로 결과가 있었던 검색 시각 — 없으면 null */
  lastPositiveAt: string | null;
  firstZeroAt: string | null;
  /** 마지막 결과 있음(없으면 최초 0건)부터 오늘(KST)까지의 일수 — "N일 지연" 배지 */
  neglectDays: number;
  /** 0건 이후 다시 결과가 나오기 시작했으면 true (자동 해소 표시) */
  resolvedByIndex: boolean;
  /** 자동 원인 분류 — engine: 색인엔 있는데 검색 0건(개발), sourcing: 색인에도 없음(MD) */
  autoCause: KeywordAutoCause;
  /** 문자열 포함 대조로 색인에서 찾은 상품 수 */
  matchedProductsCount: number;
  /** 영타 교정 결과 ("vjak"→"퍼마") — 교정 불가면 null */
  correctedQuery: string | null;
  issue: KeywordIssueDto | null;
}

/** 종합 대시보드 "오늘의 액션" 피드가 그대로 가져다 쓰는 경보 요약 — 목록과 분리해 내려간다 */
export class ZeroHitSummaryDto {
  /** 기간 내 0건 검색어 수 (자동 해소 제외) */
  zeroKeywordCount: number;
  /** 7일 이상 방치 건수 */
  neglectedOver7Days: number;
  maxNeglectDays: number;
}

export class AdminZeroHitKeywordsResponseDto {
  range: DateRangeDto;
  page: number;
  limit: number;
  totalItems: number;
  summary: ZeroHitSummaryDto;
  items: ZeroHitKeywordRowDto[];
}

export class AdminKeywordDetailQueryDto {
  @IsString()
  @IsNotEmpty()
  keyword: string;

  @Validate(IsCalendarDateConstraint, { message: 'from 은 달력에 존재하는 YYYY-MM-DD 여야 합니다' })
  from: string;

  @Validate(IsCalendarDateConstraint, { message: 'to 는 달력에 존재하는 YYYY-MM-DD 여야 합니다' })
  to: string;
}

export class AdminKeywordDetailResponseDto {
  /** 입력 그대로의 표시용 키워드 (검색 이력이 있으면 최근 표기 우선) */
  keyword: string;
  keywordNorm: string;
  range: DateRangeDto;
  previousRange: DateRangeDto;
  /** 기간 내 검색 횟수 — 0 이면 "검색 이력 없음" 정상 케이스 */
  count: number;
  zeroCount: number;
  /** 직전 동일 길이 기간의 검색 횟수 */
  previousCount: number;
  series: KeywordVolumeBucketDto[];
  lastSearchedAt: string | null;
  lastPositiveAt: string | null;
  firstZeroAt: string | null;
  /** 현재 0건 방치 중일 때만 값이 있다 */
  neglectDays: number | null;
  autoCause: KeywordAutoCause;
  matchedProductsCount: number;
  correctedQuery: string | null;
  issue: KeywordIssueDto | null;
}

export class UpsertKeywordIssueDto {
  /** 표시용 원 키워드 — 행 최초 생성 시 저장 */
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  keyword: string;

  @IsOptional()
  @IsIn(KEYWORD_ISSUE_STATUSES)
  status?: KeywordIssueStatus;

  /** null 이면 담당 해제 */
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @MaxLength(100)
  assigneeId?: string | null;

  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @MaxLength(100)
  assigneeName?: string | null;

  /** null 이면 메모 삭제 */
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @MaxLength(2000)
  memo?: string | null;
}
