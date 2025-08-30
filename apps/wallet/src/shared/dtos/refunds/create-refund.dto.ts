import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateRefundDto {
  @ApiProperty({ example: 129000, description: '환불 금액(부분 환불 가능)' })
  @IsNumber()
  @Min(1)
  amount!: number;

  @ApiProperty({ required: false, example: '고객 단순 변심' })
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiProperty({ required: false, example: { agent: 'cs_12' } })
  @IsOptional()
  metadata?: Record<string, any>;

  @ApiProperty({ required: false, example: 'refund_account_id' })
  @IsOptional()
  @IsString()
  refundAccountId?: string;

  @ApiProperty({ required: true, example: 'payment_event_id' })
  @IsString()
  capturedEventId!: string;
}
