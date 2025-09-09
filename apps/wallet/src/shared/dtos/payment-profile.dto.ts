// payment-profile.dto.ts - 결제프로필 DTO (Swagger용 클래스)
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsNumber,
  IsArray,
} from 'class-validator';

/**
 * 결제프로필 타입 enum
 */
export enum PaymentProfileTypeDto {
  CARD = 'CARD', // HMS 카드 연동
  BANK_ACCOUNT = 'BANK_ACCOUNT', // HMS CMS 연동
  BNPL = 'BNPL', // HMS BNPL 연동
}

// ❌ REWARD_POINT 제거: 포인트는 결제프로필이 아님!
// ✅ 포인트는 내부 원장 Provider (profileId 불필요)

/**
 * 결제프로필 상태 enum
 */
export enum PaymentProfileStatusDto {
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  EXPIRED = 'EXPIRED',
  BLOCKED = 'BLOCKED',
}

/**
 * 결제프로필 용도 enum
 */
export enum PaymentProfilePurposeDto {
  SUBSCRIPTION = 'SUBSCRIPTION',
  PURCHASE = 'PURCHASE',
  BOTH = 'BOTH',
}

/**
 * 결제프로필 등록 요청 DTO
 */
export class PaymentProfileCreateRequestDto {
  @ApiProperty({
    description: '사용자 ID',
    example: 'user_123456789',
  })
  @IsString()
  userId!: string;

  @ApiProperty({
    description: '결제프로필 타입',
    enum: PaymentProfileTypeDto,
    example: PaymentProfileTypeDto.CARD,
  })
  @IsEnum(PaymentProfileTypeDto)
  profileType!: PaymentProfileTypeDto;

  @ApiProperty({
    description: '결제프로필 이름 (사용자 지정)',
    example: '내 신용카드',
  })
  @IsString()
  profileName!: string;

  @ApiProperty({
    description: '결제프로필 용도',
    enum: PaymentProfilePurposeDto,
    example: PaymentProfilePurposeDto.BOTH,
  })
  @IsEnum(PaymentProfilePurposeDto)
  paymentPurpose!: PaymentProfilePurposeDto;

  @ApiProperty({
    description: '기본 결제수단 여부',
    example: false,
  })
  @IsBoolean()
  isDefault!: boolean;

  @ApiPropertyOptional({
    description: '카드 토큰 (카드 프로필 등록 시 필수)',
    example: 'card_token_12345',
  })
  @IsOptional()
  @IsString()
  cardToken?: string;

  @ApiPropertyOptional({
    description: '빌링키 (카드 프로필 등록 시 필수)',
    example: 'billing_key_67890',
  })
  @IsOptional()
  @IsString()
  billingKey?: string;

  @ApiPropertyOptional({
    description: 'BNPL 신용한도 (BNPL 프로필 등록 시 필수)',
    example: 1000000,
  })
  @IsOptional()
  @IsNumber()
  creditLimit?: number;

  @ApiPropertyOptional({
    description: 'BNPL 청구주기 일자 (BNPL 프로필 등록 시 필수)',
    example: 25,
  })
  @IsOptional()
  @IsNumber()
  billingCycleDay?: number;
}

/**
 * 결제프로필 응답 DTO
 */
export class PaymentProfileResponseDto {
  @ApiProperty({
    description: '결제프로필 ID',
    example: 'pm_123456789',
  })
  profileId!: string;

  @ApiProperty({
    description: '사용자 ID',
    example: 'user_123456789',
  })
  userId!: string;

  @ApiProperty({
    description: '결제프로필 타입',
    enum: PaymentProfileTypeDto,
    example: PaymentProfileTypeDto.CARD,
  })
  profileType!: PaymentProfileTypeDto;

  @ApiProperty({
    description: '결제프로필 이름',
    example: '내 신용카드',
  })
  profileName!: string;

  @ApiProperty({
    description: '결제프로필 상태',
    enum: PaymentProfileStatusDto,
    example: PaymentProfileStatusDto.ACTIVE,
  })
  status!: PaymentProfileStatusDto;

  @ApiProperty({
    description: '결제프로필 용도',
    enum: PaymentProfilePurposeDto,
    example: PaymentProfilePurposeDto.BOTH,
  })
  paymentPurpose!: PaymentProfilePurposeDto;

  @ApiProperty({
    description: '기본 결제수단 여부',
    example: false,
  })
  isDefault!: boolean;

  @ApiProperty({
    description: '생성일시',
    example: '2023-12-01T10:00:00.000Z',
  })
  createdAt!: string;

  @ApiProperty({
    description: '수정일시',
    example: '2023-12-01T10:00:00.000Z',
  })
  updatedAt!: string;

  @ApiPropertyOptional({
    description: 'HMS 멤버 ID (HMS 연동 시)',
    example: 'HMS_123456789',
  })
  hmsMemberId?: string;
}

/**
 * 사용자 결제프로필 목록 요약 정보
 */
export class PaymentProfileSummaryDto {
  @ApiProperty({
    description: '총 프로필 수',
    example: 3,
  })
  totalCount!: number;

  @ApiProperty({
    description: '활성 프로필 수',
    example: 2,
  })
  activeCount!: number;

  @ApiPropertyOptional({
    description: '기본 결제프로필 ID',
    example: 'pm_123456789',
  })
  defaultProfileId?: string;
}

/**
 * 사용자 결제프로필 목록 응답 DTO
 */
export class UserPaymentProfilesResponseDto {
  @ApiProperty({
    description: '사용자 ID',
    example: 'user_123456789',
  })
  userId!: string;

  @ApiProperty({
    description: '결제프로필 목록',
    type: [PaymentProfileResponseDto],
  })
  profiles!: PaymentProfileResponseDto[];

  @ApiProperty({
    description: '요약 정보',
    type: PaymentProfileSummaryDto,
  })
  summary!: PaymentProfileSummaryDto;
}
