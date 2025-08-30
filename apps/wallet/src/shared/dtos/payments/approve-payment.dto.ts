import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional } from 'class-validator';

export class ApprovePaymentDto {
  @ApiProperty({ example: 'ps_abc123' })
  @IsString()
  sessionId!: string;

  @ApiProperty({ example: 'pm_abc123' })
  @IsString()
  paymentMethodId!: string;

  @ApiProperty({ required: false, example: 'pg_key_xxx' })
  @IsOptional()
  @IsString()
  paymentKey?: string;

  @ApiProperty({ required: false, example: { orderId: 'ord_1' } })
  @IsOptional()
  metadata?: Record<string, any>;
}
