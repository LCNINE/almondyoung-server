import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { AdminRealmGuard, JwtAuthGuard } from '@app/authorization';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { GOAL_SCOPES, GoalScope, RevenueGoalService } from '../settings/revenue-goal.service';
import { GrowthSummaryQuery } from '../read-model/growth-summary.query';

/** 원/만원 혼동 같은 자릿수 사고를 막는 상한(1조 원). 화면도 같은 상한으로 미리 막는다. */
const MAX_WON = 1_000_000_000_000;

export class RevenueGoalYearQueryDto {
  @ApiProperty({ example: 2026 })
  @Type(() => Number)
  @IsInt()
  @Min(2020)
  @Max(2100)
  year: number;
}

export class PlanAssumptionsDto {
  @ApiProperty({ description: '가정한 하루 평균 방문(세션)' })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100_000_000)
  dailySessions: number;

  @ApiProperty({ description: '가정한 주문 전환율 (0~1)' })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  orderConversionRate: number;

  @ApiProperty({ description: '가정한 객단가 (원)' })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(MAX_WON)
  averageOrderValue: number;

  @ApiProperty({ description: '가정한 외부 채널 하루 평균 순매출 (원)' })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(MAX_WON)
  externalDailyRevenue: number;
}

export class CreateRevenueGoalDto {
  @ApiProperty({ example: 2027 })
  @Type(() => Number)
  @IsInt()
  @Min(2020)
  @Max(2100)
  year: number;

  @ApiPropertyOptional({ enum: GOAL_SCOPES, default: 'own_mall', description: '목표 범위 — 자사몰 순매출 / 집계된 전 판매채널 순매출' })
  @IsOptional()
  @IsIn(GOAL_SCOPES)
  scope?: GoalScope;

  @ApiProperty({ description: '연간 목표 — 범위에 해당하는 순매출 (원)', minimum: 1, maximum: MAX_WON })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_WON)
  annualTarget: number;

  @ApiPropertyOptional({ description: '1~12월 목표 (원). 생략하면 월 일수 비례로 나눈다. 합 = 연간 목표', type: [Number] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(12)
  @ArrayMaxSize(12)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(MAX_WON, { each: true })
  monthlyTargets?: number[];

  @ApiPropertyOptional({ description: '집계 시작 전(1월 1일~집계 첫날 전날) 실적 (원). 모르면 생략' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_WON)
  preCoverageActual?: number;

  @ApiPropertyOptional({ type: PlanAssumptionsDto, description: '계획 도우미로 만든 목표면 그 가정' })
  @IsOptional()
  @ValidateNested()
  @Type(() => PlanAssumptionsDto)
  planAssumptions?: PlanAssumptionsDto;

  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  memo?: string;
}

/**
 * 연간 매출 목표 설정. 고정비 설정과 같은 «관리자 입력 파라미터» 쓰기 라우트다 —
 * 집계 파이프라인과 무관하며 소비자·아웃박스가 이 표를 건드리지 않는다.
 */
@ApiTags('Statistics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminRealmGuard)
@Controller('statistics')
export class RevenueGoalController {
  constructor(
    private readonly service: RevenueGoalService,
    private readonly summary: GrowthSummaryQuery,
  ) {}

  @Get('revenue-goals')
  @ApiOperation({ summary: '연간 매출 목표 — 그 해의 현재 목표와 이력 (최신 먼저)' })
  async list(@Query() query: RevenueGoalYearQueryDto) {
    const items = await this.service.listForYear(query.year);
    return { year: query.year, current: items[0] ?? null, history: items };
  }

  @Post('revenue-goals')
  @HttpCode(201)
  @ApiOperation({ summary: '연간 매출 목표 등록 — 변경은 새 행 추가로(이력 보존), 가장 늦은 행이 현재 목표' })
  async create(@Body() dto: CreateRevenueGoalDto) {
    const created = await this.service.create({
      year: dto.year,
      scope: dto.scope,
      annualTarget: dto.annualTarget,
      monthlyTargets: dto.monthlyTargets,
      preCoverageActual: dto.preCoverageActual ?? null,
      planAssumptions: dto.planAssumptions
        ? {
            dailySessions: dto.planAssumptions.dailySessions,
            orderConversionRate: dto.planAssumptions.orderConversionRate,
            averageOrderValue: dto.planAssumptions.averageOrderValue,
            externalDailyRevenue: dto.planAssumptions.externalDailyRevenue,
          }
        : null,
      memo: dto.memo,
    });
    this.summary.invalidate();
    return created;
  }

  @Delete('revenue-goals/:id')
  @ApiOperation({ summary: '연간 매출 목표 삭제 — 직전 행이 다시 현재 목표가 된다' })
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    const removed = await this.service.remove(id);
    this.summary.invalidate();
    return removed;
  }
}
