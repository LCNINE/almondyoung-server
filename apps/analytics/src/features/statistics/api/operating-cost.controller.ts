import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { AdminRealmGuard, JwtAuthGuard } from '@app/authorization';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { OperatingCostService } from '../settings/operating-cost.service';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export class CreateOperatingCostDto {
  @ApiProperty({ description: '월 고정비 합계 (원)', minimum: 0, maximum: 1_000_000_000_000 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000_000_000)
  monthlyFixedCost: number;

  @ApiProperty({ description: '적용 시작일 (KST, YYYY-MM-DD)' })
  @Matches(DATE_ONLY)
  effectiveFrom: string;

  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  memo?: string;
}

/**
 * 월 고정비 설정. analytics 에서 유일하게 쓰기를 받는 라우트다 —
 * 이벤트 원천이 없는 **관리자 입력 파라미터**이고, 손익을 계산하는 곳이 이 서비스이기 때문이다.
 * 집계 파이프라인과는 무관하며 소비자·아웃박스가 이 표를 건드리지 않는다.
 */
@ApiTags('Statistics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminRealmGuard)
@Controller('statistics')
export class OperatingCostController {
  constructor(private readonly service: OperatingCostService) {}

  @Get('operating-costs')
  @ApiOperation({ summary: '월 고정비 설정 목록 (적용일 내림차순, 이력 포함)' })
  async list() {
    return { items: await this.service.list() };
  }

  @Post('operating-costs')
  @HttpCode(201)
  @ApiOperation({ summary: '월 고정비 등록 — 변경은 새 적용일 행 추가로(이력 보존)' })
  async create(@Body() dto: CreateOperatingCostDto) {
    return this.service.create({
      monthlyFixedCost: dto.monthlyFixedCost,
      effectiveFrom: dto.effectiveFrom,
      memo: dto.memo,
    });
  }

  @Delete('operating-costs/:id')
  @ApiOperation({ summary: '월 고정비 설정 삭제' })
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id);
  }
}
