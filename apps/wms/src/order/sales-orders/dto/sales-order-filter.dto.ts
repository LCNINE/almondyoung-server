import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsEnum, IsDateString, IsInt, Min } from 'class-validator';
import { Transform } from 'class-transformer';
import {
  OrderStatusEnum,
  orderStatusValues,
  SalesChannelEnum,
  salesChannelValues,
} from 'apps/wms/database/schemas/enum-values';

export class SalesOrderFilterDto {
  @ApiPropertyOptional({ description: '조회 시작일 (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ description: '조회 종료일 (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({
    description: '판매 채널',
    enum: salesChannelValues,
  })
  @IsOptional()
  @IsEnum(salesChannelValues)
  channel?: SalesChannelEnum;

  @ApiPropertyOptional({
    description: '주문 상태',
    enum: orderStatusValues,
  })
  @IsOptional()
  @IsEnum(orderStatusValues)
  status?: OrderStatusEnum;

  @ApiPropertyOptional({ description: '조회할 최대 개수', default: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Transform(({ value }) => parseInt(value, 10))
  limit?: number = 20;

  @ApiPropertyOptional({ description: '건너뛸 개수', default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Transform(({ value }) => parseInt(value, 10))
  offset?: number = 0;
}
