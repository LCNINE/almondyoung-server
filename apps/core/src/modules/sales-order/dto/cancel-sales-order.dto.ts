import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsObject, IsOptional, IsString } from 'class-validator';

export class CancelSalesOrderDto {
  @ApiProperty({
    description: '취소 사유 코드',
    required: false,
    example: 'CUSTOMER_REQUEST',
  })
  @IsString()
  @IsOptional()
  reasonCode?: string;

  @ApiProperty({ description: '취소 사유 상세', required: false })
  @IsString()
  @IsOptional()
  reasonDetail?: string;

  @ApiProperty({ description: '취소 주체', required: false, example: 'admin' })
  @IsString()
  @IsOptional()
  cancelledBy?: string;

  @ApiProperty({ description: '취소 발생 시각', required: false, type: String, format: 'date-time' })
  @IsDateString()
  @IsOptional()
  occurredAt?: string;

  @ApiProperty({ description: '취소 메타데이터', required: false })
  @IsObject()
  @IsOptional()
  metadata?: Record<string, unknown>;
}
