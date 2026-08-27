import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** 발주 자체를 무를 때의 사유. */
export class CancelPurchaseOrderDto {
  @ApiProperty({ description: '취소 사유 (오발주·공급처 사정 등)', maxLength: 500 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}
