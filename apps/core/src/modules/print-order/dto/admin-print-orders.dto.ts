import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import {
  PRINT_ORDER_MAX_PAGE,
  PRINT_ORDER_MAX_PAGE_SIZE,
  PRINT_ORDER_PAGE_SIZE,
  PRINT_ORDER_TABS,
  type PrintOrderTab,
} from '../services/print-order.reader';
import { type PrintCancelOutcome } from '../services/print-order-admin.manager';

export class ListPrintOrdersQueryDto {
  @ApiPropertyOptional({ enum: PRINT_ORDER_TABS, default: 'all' })
  @IsOptional()
  @IsIn(PRINT_ORDER_TABS)
  tab?: PrintOrderTab;

  @ApiPropertyOptional({ description: '주문번호·고객 이름/연락처·와우프레스 주문번호·상품명 검색' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: PRINT_ORDER_MAX_PAGE, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PRINT_ORDER_MAX_PAGE)
  page?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: PRINT_ORDER_MAX_PAGE_SIZE, default: PRINT_ORDER_PAGE_SIZE })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PRINT_ORDER_MAX_PAGE_SIZE)
  pageSize?: number;
}

export class RetryPrintOrderDto {
  @ApiPropertyOptional({
    description:
      '주문 시도 기록은 있는데 와우프레스 주문번호가 없는 건: 와우프레스에 주문이 없음을 운영자가 확인했을 때만 true',
  })
  @IsOptional()
  @IsBoolean()
  confirmNoWowpressOrder?: boolean;
}

export class ConfirmPrintTestDto {
  @ApiProperty({ description: '전화 확인 결과 메모' })
  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1)
  @MaxLength(1000)
  note!: string;
}

const OUTCOMES: PrintCancelOutcome[] = ['cancelled', 'proceed'];

export class ResolvePrintCancelDto {
  @ApiProperty({ enum: OUTCOMES })
  @IsIn(OUTCOMES)
  outcome!: PrintCancelOutcome;
}
