/**
 * 결제 세션 생성 DTO (class-validator)
 * - amount: 양수
 * - currency: MVP는 'KRW' 고정
 */
import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsNumber,
  IsOptional,
  IsBoolean,
  Min,
  IsIn,
} from 'class-validator';

export class CreatePaymentSessionDto {
  @ApiProperty({ example: 'user_123' })
  @IsString()
  userId!: string;

  @ApiProperty({ example: 129000 })
  @IsNumber()
  @Min(1)
  amount!: number;

  @ApiProperty({ example: 'KRW', enum: ['KRW'], default: 'KRW' })
  @IsString()
  @IsIn(['KRW'])
  currency!: 'KRW';

  // @ApiProperty({ example: 'pm_abc123' })
  // @IsString()
  // paymentMethodId!: string;

  @ApiProperty({ required: false, example: false })
  @IsOptional()
  @IsBoolean()
  requiresManualCapture?: boolean = false;

  @ApiProperty({ required: false, example: { medusaPaymentSessionId: 'ps_1' } })
  @IsOptional()
  metadata?: Record<string, any>;
}
