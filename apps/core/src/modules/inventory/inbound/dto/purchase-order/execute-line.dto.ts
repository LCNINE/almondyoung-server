import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, MaxLength, Min, Validate } from 'class-validator';
import { IsCalendarDateConstraint } from '../calendar-date.validator';

/** 발주 라인을 실제로 발주했다고 기록할 때 확정되는 값들. */
export class OrderPurchaseOrderLineDto {
  @ApiProperty({ description: '실제로 발주한 수량', minimum: 1 })
  @IsInt()
  @Min(1)
  orderedQty: number;

  @ApiPropertyOptional({ description: '실제 발주 단가' })
  @IsOptional()
  @IsInt()
  @Min(0)
  unitPrice?: number;

  /**
   * `@IsDateString()` 을 쓰지 않는다 — 그건 '2026-09-17T00:00:00+09:00' 도 통과시키고,
   * 그런 값을 date 컬럼에 넣으면 달력 하루가 밀린 채 저장된다. 모양 정규식도 부족하다
   * ('2026-02-31' 통과 → date/time field value out of range). calendar-date.validator.ts 참고.
   */
  @ApiPropertyOptional({ description: '이 품목의 도착예정일 (YYYY-MM-DD)' })
  @IsOptional()
  @Validate(IsCalendarDateConstraint)
  expectedArrival?: string;
}

/** 끝내 발주하지 못한 라인을 종결할 때의 사유. */
export class MarkLineUnavailableDto {
  @ApiPropertyOptional({ description: '발주하지 못한 이유 (품절·단종 등)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
