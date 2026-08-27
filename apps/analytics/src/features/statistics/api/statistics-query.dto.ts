import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsCalendarDateConstraint } from '@app/shared';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min, Validate } from 'class-validator';

/** 기간 조회 공통 파라미터. 날짜는 KST 달력 날짜(YYYY-MM-DD), 양끝 포함. */
export class StatisticsRangeQueryDto {
  @ApiProperty({ example: '2026-08-01', description: '조회 시작일 (KST, 포함)' })
  @Validate(IsCalendarDateConstraint, { message: 'from 은 달력에 존재하는 YYYY-MM-DD 여야 합니다' })
  from: string;

  @ApiProperty({ example: '2026-08-24', description: '조회 종료일 (KST, 포함)' })
  @Validate(IsCalendarDateConstraint, { message: 'to 는 달력에 존재하는 YYYY-MM-DD 여야 합니다' })
  to: string;

  @ApiPropertyOptional({ description: '판매 채널 필터 (생략 시 전체)' })
  @IsOptional()
  channel?: string;

  @ApiPropertyOptional({ enum: ['day', 'month', 'year'], default: 'day', description: '시계열 버킷 단위' })
  @IsOptional()
  @IsIn(['day', 'month', 'year'])
  granularity?: 'day' | 'month' | 'year' = 'day';
}

export class ProductStatisticsQueryDto extends StatisticsRangeQueryDto {
  @ApiPropertyOptional({ enum: ['revenue', 'quantity', 'orders'], default: 'revenue', description: '랭킹 정렬 기준' })
  @IsOptional()
  @IsIn(['revenue', 'quantity', 'orders'])
  sort?: 'revenue' | 'quantity' | 'orders' = 'revenue';

  @ApiPropertyOptional({ example: 20, default: 20, description: '랭킹 최대 행 수' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({ enum: ['desc', 'asc'], default: 'desc', description: '랭킹 정렬 방향 — asc 는 하위(bottom-N) 조회' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc' = 'desc';

  @ApiPropertyOptional({ example: 1, default: 1, description: '랭킹 페이지 (1부터)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ example: 1, default: 1, description: '옵션별 판매 페이지 (1부터) — 랭킹과 독립' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  variantPage?: number = 1;
}

export class CustomerInsightsQueryDto extends StatisticsRangeQueryDto {
  @ApiPropertyOptional({ example: 20, default: 20, description: '재구매 상품 목록 최대 행 수' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 20;

  @ApiPropertyOptional({ example: 5, default: 5, description: '재구매 목록에 올릴 최소 구매자 수 (노이즈 컷)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  minBuyers?: number = 5;

  @ApiPropertyOptional({ example: 1, default: 1, description: '재구매 상품 목록 페이지 (1부터)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;
}

export class ProfitStatisticsQueryDto extends StatisticsRangeQueryDto {
  @ApiPropertyOptional({
    enum: ['revenue', 'margin', 'marginRate', 'quantity'],
    default: 'revenue',
    description: '상품 목록 정렬 기준 — 마진 정렬에서 원가 미입력(계산 불가) 상품은 항상 뒤로 간다',
  })
  @IsOptional()
  @IsIn(['revenue', 'margin', 'marginRate', 'quantity'])
  sort?: 'revenue' | 'margin' | 'marginRate' | 'quantity' = 'revenue';

  @ApiPropertyOptional({ enum: ['desc', 'asc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc' = 'desc';

  @ApiPropertyOptional({ example: 1, default: 1, description: '페이지 (1부터)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ example: 50, default: 50, description: '페이지 크기' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 50;
}

export class UnsoldProductsQueryDto extends StatisticsRangeQueryDto {
  @ApiPropertyOptional({ example: 50, default: 50, description: '최대 행 수' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 50;

  @ApiPropertyOptional({ example: 1, default: 1, description: '페이지 (1부터)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;
}
