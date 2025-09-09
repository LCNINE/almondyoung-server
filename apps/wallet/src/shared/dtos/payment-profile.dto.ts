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
 * 결제프로필 등록 요청 DTO (공통 필드)
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

  @ApiProperty({
    description: '전화번호 (필수)',
    example: '01012345678', // 전화번호 형식 맞추기
  })
  @IsString()
  phone!: string;

  // === 신용카드 전용 필드 (callableSchema.ts 기준) ===
  @ApiPropertyOptional({
    description: '카드번호 (신용카드 프로필 등록 시 필수) - 16자 이내 숫자만',
    example: '1111222233334444', // 카드번호 형식 맞추기
  })
  @IsOptional()
  @IsString()
  paymentNumber?: string;

  @ApiPropertyOptional({
    description: '카드 소유자명 (신용카드 프로필 등록 시 필수) - 10자 이내',
    example: '홍길동', // 카드 소유자명 형식 맞추기
  })
  @IsOptional()
  @IsString()
  payerName?: string;

  @ApiPropertyOptional({
    description: '생년월일 6-10자리 (신용카드 프로필 등록 시 필수) - 숫자만',
    example: '900101', // 생년월일 형식 맞추기
  })
  @IsOptional()
  @IsString()
  payerNumber?: string;

  @ApiPropertyOptional({
    description:
      '카드 유효기간 MMYY (신용카드 프로필 등록 시 필수) - 4자리 숫자',
    example: '1225', // 카드 유효기간 형식 맞추기
  })
  @IsOptional()
  @IsString()
  validUntil?: string;

  @ApiPropertyOptional({
    description:
      '카드 비밀번호 앞 2자리 (신용카드 프로필 등록 시 필수) - 2자리 숫자',
    example: '11', // 카드 비밀번호 형식 맞추기
  })
  @IsOptional()
  @IsString()
  password?: string;

  // === 배치 CMS 전용 필드 ===
  @ApiPropertyOptional({
    description: '은행 코드 (배치 CMS 프로필 등록 시 필수)',
    example: '088',
  })
  @IsOptional()
  @IsString()
  paymentCompany?: string;

  @ApiPropertyOptional({
    description: '계좌번호 (배치 CMS 프로필 등록 시 필수)',
    example: '1234567890123456',
  })
  @IsOptional()
  @IsString()
  accountNumber?: string;

  // === BNPL 전용 필드 ===
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

  // === 공통 선택 필드 (효성 API에서 요구하지 않으므로 제거) ===
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
