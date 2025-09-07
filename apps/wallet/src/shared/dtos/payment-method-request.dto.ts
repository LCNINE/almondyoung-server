// shared/dtos/payment-method-request.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsObject,
  IsBoolean,
  IsNumber,
  IsEnum,
  ValidateNested,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * 카드 정보 DTO
 */
export class CardInfoDto {
  @ApiProperty({
    description: '카드 번호',
    example: '1234567812345678',
  })
  @IsString()
  cardNumber!: string;

  @ApiProperty({
    description: '만료 월',
    example: '12',
  })
  @IsString()
  expiryMonth!: string;

  @ApiProperty({
    description: '만료 년',
    example: '25',
  })
  @IsString()
  expiryYear!: string;

  @ApiProperty({
    description: 'CVC',
    example: '123',
  })
  @IsString()
  cvc!: string;

  @ApiPropertyOptional({
    description: '카드 소유자명',
    example: '홍길동',
  })
  @IsOptional()
  @IsString()
  cardHolderName?: string;
}

/**
 * BNPL 정보 DTO
 */
export class BnplInfoDto {
  @ApiProperty({
    description: '신용 한도',
    example: 1000000,
  })
  @IsNumber()
  @Min(100000)
  @Max(10000000)
  creditLimit!: number;

  @ApiProperty({
    description: '승인 한도',
    example: 500000,
  })
  @IsNumber()
  @Min(50000)
  @Max(5000000)
  approvedLimit!: number;

  @ApiProperty({
    description: '청구 주기 (일)',
    example: 30,
  })
  @IsNumber()
  @Min(1)
  @Max(31)
  billingCycleDay!: number;

  @ApiPropertyOptional({
    description: '약관 URL',
    example: 'https://example.com/terms',
  })
  @IsOptional()
  @IsString()
  termsUrl?: string;
}

/**
 * 통합 결제수단 등록 요청 DTO (문서 가이드라인 준수)
 * - 모든 결제수단 타입을 처리하는 단일 DTO
 */
export class PaymentMethodRequestDto {
  @ApiProperty({
    description: '사용자 ID',
    example: 'user_123456789',
  })
  @IsString()
  userId!: string;

  @ApiProperty({
    description: '결제수단 타입',
    enum: ['CARD', 'BANK_ACCOUNT', 'BNPL', 'REWARD_POINT'],
    example: 'CARD',
  })
  @IsEnum(['CARD', 'BANK_ACCOUNT', 'BNPL', 'REWARD_POINT'])
  methodType!: 'CARD' | 'BANK_ACCOUNT' | 'BNPL' | 'REWARD_POINT';

  @ApiProperty({
    description: '결제수단 별칭',
    example: '주 사용 카드',
  })
  @IsString()
  methodName!: string;

  @ApiPropertyOptional({
    description: '기본 결제수단 설정 여부',
    example: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({
    description: '결제 용도',
    enum: ['SUBSCRIPTION', 'PURCHASE', 'BOTH'],
    example: 'BOTH',
    default: 'PURCHASE',
  })
  @IsOptional()
  @IsEnum(['SUBSCRIPTION', 'PURCHASE', 'BOTH'])
  paymentPurpose?: 'SUBSCRIPTION' | 'PURCHASE' | 'BOTH';

  @ApiPropertyOptional({
    description: '카드 정보 (CARD 타입인 경우 필수)',
    type: () => CardInfoDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => CardInfoDto)
  cardInfo?: CardInfoDto;

  @ApiPropertyOptional({
    description: 'BNPL 정보 (BNPL 타입인 경우 필수)',
    type: () => BnplInfoDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => BnplInfoDto)
  bnplInfo?: BnplInfoDto;

  @ApiPropertyOptional({
    description: '추가 메타데이터',
    example: {
      hmsCustId: 'default-cust',
      registrationSource: 'web',
    },
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}
