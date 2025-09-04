import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsOptional,
  IsNumber,
  ValidateNested,
  IsBoolean,
  ValidateIf,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';

// 카드 정보 DTO
export class CardInfoDto {
  @ApiProperty({
    description: '카드 번호 (마스킹)',
    example: '1234-****-****-5678',
  })
  @IsString()
  @IsNotEmpty()
  cardNumber: string;

  @ApiProperty({ description: '카드 소유자 이름', example: '홍길동' })
  @IsString()
  @IsNotEmpty()
  cardHolderName: string;

  @ApiProperty({ description: '유효기간 (MM/YY)', example: '12/25' })
  @IsString()
  @IsNotEmpty()
  expiryDate: string;

  @ApiPropertyOptional({
    description: '휴대폰 번호 (HMS CMS 등록용)',
    example: '01012345678',
  })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({
    description: '결제일 (매월 몇일)',
    example: 15,
    minimum: 1,
    maximum: 28,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(28)
  billingCycleDay?: number;

  @ApiPropertyOptional({
    description: '빌링키 (외부 PG사 토큰)',
    example: 'billing_key_123',
  })
  @IsOptional()
  @IsString()
  billingKey?: string;
}

// 🗑️ BankInfo 제거: 현재 지원하지 않음 (CARD, REWARD_POINT만 지원)

// 메인 DTO
export class CreateGeneralPaymentMethodDto {
  @ApiProperty({ description: '사용자 ID', example: 'user_123456789' })
  @IsString()
  @IsNotEmpty()
  userId: string;

  @ApiProperty({
    description: '결제수단 타입 (BNPL은 /bnpl/register 사용)',
    enum: ['CARD', 'REWARD_POINT'],
    example: 'CARD',
  })
  @IsEnum(['CARD', 'REWARD_POINT'])
  methodType: 'CARD' | 'REWARD_POINT';

  @ApiProperty({ description: '결제수단 별칭', example: '주 사용 카드' })
  @IsString()
  @IsNotEmpty()
  methodName: string;

  @ApiPropertyOptional({
    description: '기본 결제수단 설정 여부',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({
    description: '카드 정보 (methodType이 CARD인 경우 필수)',
    type: CardInfoDto,
  })
  @ValidateIf((o: CreateGeneralPaymentMethodDto) => o.methodType === 'CARD')
  @IsNotEmpty({ message: 'methodType이 CARD인 경우 cardInfo는 필수입니다' })
  @ValidateNested()
  @Type(() => CardInfoDto)
  cardInfo?: CardInfoDto;
}

// Response DTO (class-validator 불필요)
export class PaymentMethodResponseDto {
  @ApiProperty({ description: '결제수단 ID' })
  id: string;

  @ApiProperty({ description: '사용자 ID' })
  userId: string;

  @ApiProperty({ description: '결제수단 타입' })
  methodType: string;

  @ApiProperty({ description: '결제수단 이름' })
  methodName: string;

  @ApiProperty({ description: '기본 결제수단 여부' })
  isDefault: boolean;

  @ApiProperty({ description: '결제수단 상태' })
  status: string;

  @ApiProperty({ description: '생성일시' })
  createdAt: string;

  @ApiProperty({ description: '수정일시' })
  updatedAt: string;
}
