import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** 잔량을 포기하고 입고예정 아이템을 종결할 때의 사유. */
export class ClosePlanItemDto {
  @ApiProperty({ description: '더 기다리지 않기로 한 이유 (공급처 결품·선적 누락 등)', maxLength: 500 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}
