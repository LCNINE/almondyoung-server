import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsNumber, Min } from 'class-validator';

export class CapturePaymentDto {
  @ApiProperty({ required: false, example: 129000 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  amount?: number;

  @ApiProperty({ required: false, example: { orderId: 'ord_1' } })
  @IsOptional()
  metadata?: Record<string, any>;
}
