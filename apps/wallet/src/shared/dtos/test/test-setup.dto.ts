// shared/dtos/test/test-setup.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNumber, IsOptional, Min } from 'class-validator';

export class CreateTestCardDto {
  @ApiProperty({
    example: 'user_123',
    description: '사용자 ID',
  })
  @IsString()
  userId!: string;

  @ApiProperty({
    example: '테스트 카드',
    description: '결제수단 이름',
    default: '테스트 카드',
  })
  @IsOptional()
  @IsString()
  methodName?: string;

  @ApiProperty({
    example: '1234567890123456',
    description: '카드번호 (테스트용)',
    default: '1234567890123456',
  })
  @IsOptional()
  @IsString()
  cardNumber?: string;
}

export class CreateTestBnplDto {
  @ApiProperty({
    example: 'user_123',
    description: '사용자 ID',
  })
  @IsString()
  userId!: string;

  @ApiProperty({
    example: '테스트 BNPL',
    description: '결제수단 이름',
    default: '테스트 BNPL',
  })
  @IsOptional()
  @IsString()
  methodName?: string;

  @ApiProperty({
    example: 1000000,
    description: '신용 한도',
    default: 1000000,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  creditLimit?: number;

  @ApiProperty({
    example: 15,
    description: '청구 주기 (일)',
    default: 15,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  billingCycleDay?: number;
}

export class ChargePointsDto {
  @ApiProperty({
    example: 'user_123',
    description: '사용자 ID',
  })
  @IsString()
  userId!: string;

  @ApiProperty({
    example: 50000,
    description: '충전할 포인트 금액',
  })
  @IsNumber()
  @Min(1)
  amount!: number;

  @ApiProperty({
    example: '테스트 포인트 충전',
    description: '충전 사유',
    default: '테스트 포인트 충전',
  })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class TestPaymentMethodResponseDto {
  @ApiProperty({ example: 'pm_test_abc123' })
  paymentMethodId!: string;

  @ApiProperty({ example: 'CARD' })
  methodType!: string;

  @ApiProperty({ example: '테스트 카드' })
  methodName!: string;

  @ApiProperty({ example: 'ACTIVE' })
  status!: string;

  @ApiProperty({ required: false })
  metadata?: Record<string, any>;
}

export class PointsResponseDto {
  @ApiProperty({ example: 'user_123' })
  userId!: string;

  @ApiProperty({ example: 50000 })
  balance!: number;

  @ApiProperty({ example: 25000, required: false })
  charged?: number;

  @ApiProperty({ example: '포인트 충전 완료', required: false })
  message?: string;
}
