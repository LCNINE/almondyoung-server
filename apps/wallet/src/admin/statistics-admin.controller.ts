import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { paymentMethodTypeEnum, PaymentMethodType } from '../schema';
import { StatisticsAdminService } from './statistics-admin.service';
import { WalletAdminAuth } from '../wallet-admin-auth.decorator';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

class CreateFeeRateDto {
  @ApiProperty({ enum: paymentMethodTypeEnum.enumValues })
  @IsIn(paymentMethodTypeEnum.enumValues)
  methodType: PaymentMethodType;

  @ApiProperty({ description: '수수료율(만분율). 2.9% = 290', minimum: 0, maximum: 10000 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10000)
  feeRateBp: number;

  @ApiProperty({ description: '적용 시작일 (KST, YYYY-MM-DD)' })
  @Matches(DATE_ONLY)
  effectiveFrom: string;

  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  memo?: string;
}

class StatisticsRangeQueryDto {
  @ApiProperty({ description: '조회 시작일 (KST, YYYY-MM-DD)' })
  @Matches(DATE_ONLY)
  from: string;

  @ApiProperty({ description: '조회 종료일 (KST, YYYY-MM-DD, inclusive)' })
  @Matches(DATE_ONLY)
  to: string;
}

@ApiTags('Admin - Statistics')
@WalletAdminAuth()
@Controller('v1/admin/statistics')
export class StatisticsAdminController {
  constructor(private readonly service: StatisticsAdminService) {}

  @Get('fee-rates')
  @ApiOperation({ summary: '결제수단별 수수료율 목록 (이력 포함)' })
  async listFeeRates() {
    return this.service.listFeeRates();
  }

  @Post('fee-rates')
  @HttpCode(201)
  @ApiOperation({ summary: '수수료율 등록 — 변경은 새 적용일 행 추가로(이력 보존)' })
  async createFeeRate(@Body() dto: CreateFeeRateDto) {
    return this.service.createFeeRate({
      methodType: dto.methodType,
      feeRateBp: dto.feeRateBp,
      effectiveFrom: dto.effectiveFrom,
      memo: dto.memo,
    });
  }

  @Delete('fee-rates/:id')
  @ApiOperation({ summary: '수수료율 삭제' })
  async deleteFeeRate(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.deleteFeeRate(id);
  }

  @Get('fees')
  @ApiOperation({ summary: '기간 결제수단별 추정 수수료 요약 (캡처 금액 × 시점 요율)' })
  async getFeeSummary(@Query() query: StatisticsRangeQueryDto) {
    return this.service.getFeeSummary(query.from, query.to);
  }

  @Get('membership-revenue')
  @ApiOperation({ summary: '멤버십 구독료 수입 (PAID 인보이스, finalized_at KST 기준)' })
  async getMembershipRevenue(@Query() query: StatisticsRangeQueryDto) {
    return this.service.getMembershipRevenue(query.from, query.to);
  }
}
