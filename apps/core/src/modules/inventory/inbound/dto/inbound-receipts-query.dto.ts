import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min, Validate } from 'class-validator';
import { IsCalendarDateConstraint } from '../../shared/dto/calendar-date.validator';

export const inboundReceiptMethods = ['individual', 'simple', 'simple_fullscan', 'planned'] as const;
export type InboundReceiptMethod = (typeof inboundReceiptMethods)[number];

export const inboundReceiptStatuses = ['posted', 'voided', 'all'] as const;
export type InboundReceiptStatusFilter = (typeof inboundReceiptStatuses)[number];

function strictOptionalInteger(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'number') return value;
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value)) return Number.NaN;
  return Number(value);
}

export class InboundReceiptsQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  skuId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: '정확한 입고 회차 ID. warehouseId와 함께 사용한다.' })
  @IsOptional()
  @IsUUID()
  receiptId?: string;

  @ApiPropertyOptional({ enum: inboundReceiptMethods })
  @IsOptional()
  @IsIn(inboundReceiptMethods)
  method?: InboundReceiptMethod;

  @ApiPropertyOptional({ enum: inboundReceiptStatuses, default: 'posted' })
  @IsOptional()
  @IsIn(inboundReceiptStatuses)
  status?: InboundReceiptStatusFilter;

  @ApiPropertyOptional({ description: '서울 달력 날짜 (YYYY-MM-DD)' })
  @IsOptional()
  @Validate(IsCalendarDateConstraint)
  startDate?: string;

  @ApiPropertyOptional({ description: '서울 달력 날짜 (YYYY-MM-DD)' })
  @IsOptional()
  @Validate(IsCalendarDateConstraint)
  endDate?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 50 })
  @Transform(({ value }) => strictOptionalInteger(value))
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 50;

  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @Transform(({ value }) => strictOptionalInteger(value))
  @IsInt()
  @Min(0)
  offset = 0;
}
