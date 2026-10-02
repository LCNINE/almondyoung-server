import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsCalendarDateConstraint } from '@app/shared';
import { IsIn, IsOptional, Validate } from 'class-validator';

export const GROWTH_GRANULARITIES = ['day', 'week', 'month'] as const;
export type GrowthGranularity = (typeof GROWTH_GRANULARITIES)[number];

/**
 * 성장 탭 조회 파라미터. 기존 `StatisticsRangeQueryDto` 를 넓히지 않고 따로 둔다 — 그 DTO 는 기존 라우트
 * 전부가 공유하므로 «주» 를 거기 넣으면 주를 처리하지 못하는 라우트가 그 값을 받게 된다.
 */
export class GrowthRangeQueryDto {
  @ApiProperty({ example: '2026-09-01', description: '조회 시작일 (KST, 포함)' })
  @Validate(IsCalendarDateConstraint, { message: 'from 은 달력에 존재하는 YYYY-MM-DD 여야 합니다' })
  from: string;

  @ApiProperty({ example: '2026-09-30', description: '조회 종료일 (KST, 포함)' })
  @Validate(IsCalendarDateConstraint, { message: 'to 는 달력에 존재하는 YYYY-MM-DD 여야 합니다' })
  to: string;

  @ApiPropertyOptional({ enum: GROWTH_GRANULARITIES, default: 'day', description: '시계열 버킷 — 주는 ISO 주(월요일 시작, KST)' })
  @IsOptional()
  @IsIn(GROWTH_GRANULARITIES)
  granularity?: GrowthGranularity = 'day';
}
