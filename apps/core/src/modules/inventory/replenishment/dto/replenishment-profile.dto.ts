import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

export const REFRESH_SERIES = ['window', 'full'] as const;

export class RecomputeProfilesQueryDto {
  @ApiPropertyOptional({ enum: REFRESH_SERIES, default: 'window', description: 'window = 최근 demand_recompute_days 창, full = D0 이후 전량' })
  @IsOptional()
  @IsIn(REFRESH_SERIES)
  series?: (typeof REFRESH_SERIES)[number];
}

export class DemandRebuildResultDto {
  @ApiPropertyOptional({ nullable: true }) from: string | null;
  @ApiProperty() to: string;
  @ApiProperty() rows: number;
}

export class PatternCountsDto {
  @ApiProperty() smooth: number;
  @ApiProperty() intermittent: number;
  @ApiProperty() erratic: number;
  @ApiProperty() lumpy: number;
  @ApiProperty() insufficient: number;
  @ApiProperty() none: number;
}

export class ProfileRefreshResultDto {
  @ApiProperty() skus: number;
  @ApiProperty({ type: PatternCountsDto }) byPattern: PatternCountsDto;
}

export class LeadTimeRefreshResultDto {
  @ApiProperty() suppliers: number;
  @ApiProperty() routes: number;
  @ApiProperty() windowFrom: string;
  @ApiProperty() windowTo: string;
}

export class RefreshSummaryDto {
  @ApiProperty({ enum: REFRESH_SERIES }) series: string;
  @ApiProperty() today: string;
  @ApiProperty() startedAt: string;
  @ApiProperty() finishedAt: string;
  @ApiProperty({ type: DemandRebuildResultDto }) demandSeries: DemandRebuildResultDto;
  @ApiProperty({ type: ProfileRefreshResultDto }) profiles: ProfileRefreshResultDto;
  @ApiProperty({ type: LeadTimeRefreshResultDto }) leadTimes: LeadTimeRefreshResultDto;
}
