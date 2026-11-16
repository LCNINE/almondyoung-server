import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, PermissionGuard, RequirePermission, User } from '@app/authorization';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsISO8601,
  IsUUID,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { RevenueReportService } from '../read-model/revenue-report.service';

export class RevenueReportYearDto {
  @Type(() => Number)
  @IsInt()
  @Min(2020)
  @Max(2099)
  year: number;

  @IsOptional()
  @IsIn(['true', 'false'])
  includeHistory?: string;
}

export class ExternalRevenueRowDto {
  @IsOptional()
  @IsISO8601()
  expectedUpdatedAt?: string | null;

  @IsIn(['coupang', 'naver', 'phone', 'cafe24'])
  channel: string;

  @IsString()
  @MaxLength(100)
  account: string;

  @Matches(/^20[2-9]\d-(0[1-9]|1[0-2])$/)
  month: string;

  @IsIn(['purchase_confirmed', 'paid', 'order', 'tax_report', 'operational_net'])
  basis: string;

  @IsInt()
  @Min(-1_000_000_000_000)
  @Max(1_000_000_000_000)
  amount: number;

  @IsString()
  @MaxLength(255)
  source: string;

  @IsOptional()
  @IsIn(['pending', 'confirmed'])
  originalStatus?: string;

  @IsOptional()
  @IsIn(['pending', 'confirmed'])
  monthlyStatus?: string;

  @IsOptional()
  @IsIn(['pending', 'confirmed'])
  duplicateStatus?: string;

  @IsOptional()
  @IsIn(['pending', 'confirmed'])
  settlementStatus?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reviewNote?: string;
}

export class RevenueRawQueryDto extends RevenueReportYearDto {
  @IsOptional()
  @IsUUID()
  after?: string;

  @IsOptional()
  @IsUUID()
  through?: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  page: number = 0;
}

export class ImportExternalRevenueDto {
  @IsOptional()
  @IsUUID()
  batchId?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1200)
  @ValidateNested({ each: true })
  @Type(() => ExternalRevenueRowDto)
  rows: ExternalRevenueRowDto[];
}

@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('statistics/revenue-report')
export class RevenueReportController {
  constructor(private readonly service: RevenueReportService) {}

  @Get()
  @RequirePermission('analytics.report.read')
  get(@Query() query: RevenueReportYearDto) {
    return this.service.get(query.year, query.includeHistory !== 'false');
  }

  @Get('history')
  @RequirePermission('analytics.report.read')
  history(@Query() query: RevenueReportYearDto) {
    return this.service.history(query.year);
  }

  @Get('raw')
  @RequirePermission('analytics.report.read')
  raw(@Query() query: RevenueRawQueryDto) {
    return this.service.raw(query.year, query.page, query.after, query.through);
  }

  @Post('external')
  @RequirePermission('analytics.setting.write')
  import(@Body() dto: ImportExternalRevenueDto, @User() user?: { userId?: string }) {
    return this.service.import(dto.rows, user?.userId, dto.batchId);
  }
}
