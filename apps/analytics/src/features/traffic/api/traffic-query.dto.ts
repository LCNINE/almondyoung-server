import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsCalendarDateConstraint } from '@app/shared';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min, Validate } from 'class-validator';

export class TrafficStatisticsQueryDto {
  @ApiProperty({ example: '2026-08-01', description: '조회 시작일 (GA4 속성 시간대 기준, 포함)' })
  @Validate(IsCalendarDateConstraint, { message: 'from 은 달력에 존재하는 YYYY-MM-DD 여야 합니다' })
  from: string;

  @ApiProperty({ example: '2026-08-24', description: '조회 종료일 (GA4 속성 시간대 기준, 포함)' })
  @Validate(IsCalendarDateConstraint, { message: 'to 는 달력에 존재하는 YYYY-MM-DD 여야 합니다' })
  to: string;

  @ApiPropertyOptional({
    enum: ['organic', 'all'],
    default: 'organic',
    description: '채널 그룹 — organic 은 자연검색(Organic Search)만, all 은 전체 유입',
  })
  @IsOptional()
  @IsIn(['organic', 'all'])
  channelGroup?: 'organic' | 'all' = 'organic';

  @ApiPropertyOptional({
    example: 10,
    default: 10,
    description: '랜딩페이지·국가 목록 최대 행 수 — 전체 열람은 큰 limit 1회 조회 후 화면 페이지네이션 (GA4 는 서버 offset 미사용)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  limit?: number = 10;
}

export class TrafficTotalsDto {
  sessions: number;
  totalUsers: number;
  pageViews: number;
  /** 참여 세션(10초 이상 체류·전환·2페이지 이상) ÷ 전체 세션. GA4 bounceRate 의 역수 */
  engagementRate: number | null;
}

export class TrafficDailyBucketDto {
  /** GA4 속성 시간대의 달력 날짜 (YYYY-MM-DD) */
  date: string;
  sessions: number;
  engagementRate: number | null;
}

export class LandingPageRowDto {
  path: string;
  sessions: number;
  engagementRate: number | null;
}

export class SessionsByDimensionRowDto {
  label: string;
  sessions: number;
}

export class TrafficStatisticsResponseDto {
  /** false 면 GA4 env 미배선 — 화면은 "연동 대기"를 보여준다 */
  enabled: boolean;
  range: { from: string; to: string };
  channelGroup: 'organic' | 'all';
  totals: TrafficTotalsDto | null;
  series: TrafficDailyBucketDto[];
  landingPages: LandingPageRowDto[];
  devices: SessionsByDimensionRowDto[];
  countries: SessionsByDimensionRowDto[];
}

/** 실시간 축의 지표는 세션이 아니라 활성 사용자다 — 필드명을 세션과 섞지 않는다. */
export class RealtimeDimensionRowDto {
  label: string;
  activeUsers: number;
}

export class RealtimeBucketDto {
  /** 'N분 전' — GA4 minutesAgo(0~29). 0 이 지금 이 순간. */
  minutesAgo: number;
  activeUsers: number;
}

export class RealtimeTrafficResponseDto {
  /** false 면 GA4 env 미배선 — 화면은 "연동 대기"를 보여준다 */
  enabled: boolean;
  /** 최근 30분 활성 사용자. GA4 실시간 창이 30분 고정이라 기간을 고를 수 없다. */
  activeUsers: number;
  /** 응답을 만든 순간(UTC ISO). 실시간 화면은 언제 찍은 값인지가 특히 중요하다. */
  observedAt: string;
  byMinute: RealtimeBucketDto[];
  pages: RealtimeDimensionRowDto[];
  devices: RealtimeDimensionRowDto[];
}
