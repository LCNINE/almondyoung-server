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
 * kind 필드로 CARD/BATCH 구분 유지
 */
export enum PaymentProfileTypeDto {
  CARD = 'CARD', // HMS 카드 연동
  BANK_ACCOUNT = 'BANK_ACCOUNT', // HMS 배치 CMS 연동 (BATCH로 매핑)
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
 * HMS/CMS API별 필수 필드 명시적 분리
 */
export class PaymentProfileCreateRequestDto {
  // === 공통 CMS 프로필 필수값 ===
  @ApiProperty({
    description: '사용자 ID (공통 필수)',
    example: 'user_123456789',
  })
  @IsString()
  userId!: string;

  @ApiProperty({
    description: '결제수단 종류 (CARD: HMS 카드, BANK_ACCOUNT: HMS 배치 CMS)',
    enum: PaymentProfileTypeDto,
    example: PaymentProfileTypeDto.CARD,
  })
  @IsEnum(PaymentProfileTypeDto)
  profileType!: PaymentProfileTypeDto;

  @ApiProperty({
    description: '결제수단 별칭 (사용자 지정, 공통 필수)',
    example: '내 신용카드',
  })
  @IsString()
  profileName!: string;

  @ApiProperty({
    description: '결제프로필 용도 (공통 필수)',
    enum: PaymentProfilePurposeDto,
    example: PaymentProfilePurposeDto.BOTH,
  })
  @IsEnum(PaymentProfilePurposeDto)
  paymentPurpose!: PaymentProfilePurposeDto;

  @ApiProperty({
    description: '기본 결제수단 여부 (공통 필수)',
    example: false,
  })
  @IsBoolean()
  isDefault!: boolean;

  @ApiProperty({
    description: '전화번호 (공통 필수)',
    example: '01012345678',
  })
  @IsString()
  phone!: string;

  // === HMS 카드 회원등록 API 필수값 ===
  @ApiPropertyOptional({
    description: '카드번호 (HMS 카드 회원등록 API 필수) - 16자 이내 숫자만',
    example: '1111222233334444',
  })
  @IsOptional()
  @IsString()
  paymentNumber?: string;

  @ApiPropertyOptional({
    description: '카드 소유자명 (HMS 카드 회원등록 API 필수) - 10자 이내',
    example: '홍길동',
  })
  @IsOptional()
  @IsString()
  payerName?: string;

  @ApiPropertyOptional({
    description: '생년월일 (HMS 카드 회원등록 API 필수) - 6-10자리 숫자만',
    example: '900101',
  })
  @IsOptional()
  @IsString()
  payerNumber?: string;

  @ApiPropertyOptional({
    description: '카드 유효기간 MMYY (HMS 카드 회원등록 API 필수) - 4자리 숫자',
    example: '1225',
  })
  @IsOptional()
  @IsString()
  validUntil?: string;

  @ApiPropertyOptional({
    description:
      '카드 비밀번호 앞 2자리 (HMS 카드 회원등록 API 필수) - 2자리 숫자',
    example: '11',
  })
  @IsOptional()
  @IsString()
  password?: string;

  @ApiPropertyOptional({
    description: '카드사 코드 (HMS 카드 회원등록 API 필수)',
    example: '088',
  })
  @IsOptional()
  @IsString()
  paymentCompany?: string;

  // === HMS 배치(CMS 계좌) 등록 API 필수값 ===
  @ApiPropertyOptional({
    description: '계좌번호 (HMS 배치 CMS 등록 API 필수)',
    example: '1234567890123456',
  })
  @IsOptional()
  @IsString()
  accountNumber?: string;

  @ApiPropertyOptional({
    description: '결제일 (HMS 배치 CMS 등록 API 필수) - 1-31',
    example: 1,
  })
  @IsOptional()
  @IsNumber()
  billingDay?: number;

  @ApiPropertyOptional({
    description: '동의서 ID (HMS 배치 CMS 등록 API 필수)',
    example: 'consent_123456789',
  })
  @IsOptional()
  @IsString()
  consentId?: string;

  @ApiPropertyOptional({
    description: '동의서 키 (HMS 배치 CMS 등록 API 필수)',
    example: 'agreement_key_xyz',
  })
  @IsOptional()
  @IsString()
  agreementKey?: string;

  @ApiPropertyOptional({
    description: '동의서 종류 (HMS 배치 CMS 등록 API 필수)',
    example: 'CMS_AGREEMENT',
  })
  @IsOptional()
  @IsString()
  agreementKind?: string;

  @ApiPropertyOptional({
    description: '동의 상태 (HMS 배치 CMS 등록 API 필수)',
    example: 'APPROVED',
  })
  @IsOptional()
  @IsString()
  consentStatus?: string;

  @ApiPropertyOptional({
    description: '동의서 제출 시간 (HMS 배치 CMS 등록 API 필수)',
    example: '2024-01-01T10:00:00Z',
  })
  @IsOptional()
  @IsString()
  consentSubmittedAt?: string;

  @ApiPropertyOptional({
    description: '동의서 검토 시간 (HMS 배치 CMS 등록 API 필수)',
    example: '2024-01-01T10:05:00Z',
  })
  @IsOptional()
  @IsString()
  consentReviewedAt?: string;

  // === BNPL 전용 필드 ===
  @ApiPropertyOptional({
    description: 'BNPL 신용한도 (BNPL 프로필 등록 시 필수)',
    example: 1000000,
  })
  @IsOptional()
  @IsNumber()
  creditLimit?: number;

  // === UI나 운영자 메모 등 부가 정보용(metadata 전용) ===
  @ApiPropertyOptional({
    description: '부가 정보 (UI 컨텍스트, 운영자 메모 등)',
    example: {
      source: 'mobile_app',
      userAgent: 'Mozilla/5.0...',
      adminNote: '테스트 계정',
    },
  })
  @IsOptional()
  metadata?: Record<string, any>;
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
