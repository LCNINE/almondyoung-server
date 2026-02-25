import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentMethodType } from '../../schema';

export class CreatePaymentMethodDto {
  @ApiProperty({ description: 'Payment method type', enum: ['POINTS', 'CARD', 'BANK_TRANSFER', 'BNPL'] })
  @IsEnum(['POINTS', 'CARD', 'BANK_TRANSFER', 'BNPL'])
  type: PaymentMethodType;

  @ApiProperty({ description: 'User ID', maxLength: 128 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  userId: string;

  @ApiPropertyOptional({ description: 'Display name for the payment method', maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  displayName?: string;

  @ApiPropertyOptional({ description: 'Provider-specific data (e.g. card token)' })
  @IsOptional()
  providerData?: Record<string, unknown>;
}

export class PaymentMethodResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  userId: string;

  @ApiProperty()
  type: PaymentMethodType;

  @ApiProperty()
  displayName: string | null;

  @ApiProperty()
  isReusable: boolean;

  @ApiProperty()
  createdAt: Date;
}
