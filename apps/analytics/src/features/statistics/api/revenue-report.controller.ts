import { BadRequestException, Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, PermissionGuard, RequirePermission } from '@app/authorization';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
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
  @Max(2100)
  year: number;
}

export class ExternalRevenueRowDto {
  @IsIn(['coupang', 'naver', 'phone'])
  channel: string;

  @IsString()
  @MaxLength(100)
  account: string;

  @Matches(/^20\d{2}-(0[1-9]|1[0-2])$/)
  month: string;

  @IsIn(['purchase_confirmed', 'paid', 'order', 'tax_report'])
  basis: string;

  @IsInt()
  @Min(-1_000_000_000_000)
  @Max(1_000_000_000_000)
  amount: number;

  @IsString()
  @MaxLength(255)
  source: string;
}

export class RevenueRawQueryDto extends RevenueReportYearDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  page: number = 0;
}

export class ImportExternalRevenueDto {
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
    return this.service.get(query.year);
  }

  @Get('raw')
  @RequirePermission('analytics.report.read')
  raw(@Query() query: RevenueRawQueryDto) {
    return this.service.raw(query.year, query.page);
  }

  @Post('external')
  @RequirePermission('analytics.setting.write')
  import(@Body() dto: ImportExternalRevenueDto) {
    const keys = new Set<string>();

    for (const row of dto.rows) {
      row.account = row.account.trim();
      row.source = row.source.trim();
      const key = JSON.stringify([row.channel, row.account, row.month, row.basis]);

      if (!row.account || !row.source || keys.has(key)) {
        throw new BadRequestException('계정·출처를 입력하고 같은 채널·계정·월·기준의 중복 행을 제거해 주세요.');
      }

      keys.add(key);
    }

    return this.service.import(dto.rows);
  }
}
