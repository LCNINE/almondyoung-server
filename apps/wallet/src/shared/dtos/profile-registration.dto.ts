// shared/dtos/profile-registration.dto.ts

import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsOptional,
  IsObject,
  IsArray,
  IsBoolean,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  CreateMemberRequestDto,
  RegisterAgreementRequest,
} from 'hms-api-wrapper';

/**
 * Provider별 특화된 결제프로필 등록 요청
 * Discriminated Union으로 강제 타입 분기
 */

// === HMS BNPL 출금동의서 데이터 ===
export class BnplConsentDataDto {
  @ApiProperty({
    description: 'HMS 회원 정보',
    type: 'object',
    additionalProperties: true,
  })
  @IsObject()
  @ValidateNested()
  @Type(() => Object) // CreateMemberRequestDto는 외부 타입이므로 Object로 처리
  memberInfo!: CreateMemberRequestDto;

  @ApiProperty({
    description: '동의서 파일 목록',
    type: 'array',
    items: { type: 'object', additionalProperties: true },
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => Object) // RegisterAgreementRequest는 외부 타입이므로 Object로 처리
  agreementFiles!: RegisterAgreementRequest[];

  @ApiProperty({
    description: '신청 사유',
    example: '온라인 쇼핑몰 후불결제 이용',
    required: false,
  })
  @IsOptional()
  @IsString()
  applicationReason?: string;

  @ApiProperty({
    description: '예상 이용 규모',
    example: '월 평균 50만원 내외',
    required: false,
  })
  @IsOptional()
  @IsString()
  expectedUsage?: string;
}

// === HMS 카드 등록 데이터 ===
export class CardRegistrationDataDto {
  @ApiProperty({
    description: '카드 토큰 (PG사에서 발급)',
    example: 'card_token_abcdef123456',
  })
  @IsString()
  @IsNotEmpty()
  cardToken!: string;

  @ApiProperty({
    description: '빌링키 (자동결제용)',
    example: 'billing_key_xyz789',
  })
  @IsString()
  @IsNotEmpty()
  billingKey!: string;

  @ApiProperty({
    description: '카드 별칭',
    example: '주 결제카드',
    required: false,
  })
  @IsOptional()
  @IsString()
  cardAlias?: string;
}

// === TOSS 프로필 데이터 ===
export class TossProfileDataDto {
  @ApiProperty({
    description: 'TOSS 고객 키',
    example: 'toss_customer_key_12345',
  })
  @IsString()
  @IsNotEmpty()
  customerKey!: string;

  @ApiProperty({
    description: '자동결제용 빌링키',
    example: 'toss_billing_key_abcdef',
  })
  @IsString()
  @IsNotEmpty()
  billingKey!: string;
}

// === Discriminated Union 기반 요청 DTO ===

/**
 * HMS BNPL 출금동의서 등록 요청
 */
export class BnplProfileRegistrationDto {
  @ApiProperty({
    description: 'Provider 타입',
    enum: ['HMS_BNPL'],
    example: 'HMS_BNPL',
  })
  @IsEnum(['HMS_BNPL'])
  provider!: 'HMS_BNPL';

  @ApiProperty({
    description: '사용자 ID',
    example: 'user_12345',
  })
  @IsString()
  @IsNotEmpty()
  userId!: string;

  @ApiProperty({
    description: '프로필 이름',
    example: 'BNPL 후불결제',
  })
  @IsString()
  @IsNotEmpty()
  profileName!: string;

  @ApiProperty({
    description: '결제 용도',
    enum: ['ORDER', 'RECURRING', 'BOTH'],
    example: 'BOTH',
  })
  @IsEnum(['ORDER', 'RECURRING', 'BOTH'])
  paymentPurpose!: 'ORDER' | 'RECURRING' | 'BOTH';

  @ApiProperty({
    description: '기본 결제수단 설정 여부',
    example: false,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiProperty({
    description: 'BNPL 출금동의서 데이터',
    type: BnplConsentDataDto,
  })
  @ValidateNested()
  @Type(() => BnplConsentDataDto)
  bnplData!: BnplConsentDataDto;
}

/**
 * HMS 카드 프로필 등록 요청
 */
export class CardProfileRegistrationDto {
  @ApiProperty({
    description: 'Provider 타입',
    enum: ['HMS_CARD'],
    example: 'HMS_CARD',
  })
  @IsEnum(['HMS_CARD'])
  provider!: 'HMS_CARD';

  @ApiProperty({
    description: '사용자 ID',
    example: 'user_12345',
  })
  @IsString()
  @IsNotEmpty()
  userId!: string;

  @ApiProperty({
    description: '프로필 이름',
    example: '신한카드 ****1234',
  })
  @IsString()
  @IsNotEmpty()
  profileName!: string;

  @ApiProperty({
    description: '결제 용도',
    enum: ['ORDER', 'RECURRING', 'BOTH'],
    example: 'BOTH',
  })
  @IsEnum(['ORDER', 'RECURRING', 'BOTH'])
  paymentPurpose!: 'ORDER' | 'RECURRING' | 'BOTH';

  @ApiProperty({
    description: '기본 결제수단 설정 여부',
    example: true,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiProperty({
    description: 'HMS 카드 등록 데이터',
    type: CardRegistrationDataDto,
  })
  @ValidateNested()
  @Type(() => CardRegistrationDataDto)
  cardData!: CardRegistrationDataDto;
}

/**
 * TOSS 프로필 등록 요청
 */
export class TossProfileRegistrationDto {
  @ApiProperty({
    description: 'Provider 타입',
    enum: ['TOSS'],
    example: 'TOSS',
  })
  @IsEnum(['TOSS'])
  provider!: 'TOSS';

  @ApiProperty({
    description: '사용자 ID',
    example: 'user_12345',
  })
  @IsString()
  @IsNotEmpty()
  userId!: string;

  @ApiProperty({
    description: '프로필 이름',
    example: 'TOSS 간편결제',
  })
  @IsString()
  @IsNotEmpty()
  profileName!: string;

  @ApiProperty({
    description: '결제 용도',
    enum: ['ORDER', 'RECURRING', 'BOTH'],
    example: 'ORDER',
  })
  @IsEnum(['ORDER', 'RECURRING', 'BOTH'])
  paymentPurpose!: 'ORDER' | 'RECURRING' | 'BOTH';

  @ApiProperty({
    description: '기본 결제수단 설정 여부',
    example: false,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiProperty({
    description: 'TOSS 프로필 데이터',
    type: TossProfileDataDto,
  })
  @ValidateNested()
  @Type(() => TossProfileDataDto)
  tossData!: TossProfileDataDto;
}

/**
 * 통합 프로필 등록 요청 (Discriminated Union)
 */
export type ProfileRegistrationRequestDto =
  | BnplProfileRegistrationDto
  | CardProfileRegistrationDto
  | TossProfileRegistrationDto;

/**
 * 프로필 등록 응답 DTO
 */
export class ProfileRegistrationResponseDto {
  @ApiProperty({
    description: '등록 성공 여부',
    example: true,
  })
  success!: boolean;

  @ApiProperty({
    description: '결제프로필 ID (성공 시)',
    example: 'pp_01HQZX8QJKMNPQRST9VWXY012',
    required: false,
  })
  profileId?: string;

  @ApiProperty({
    description: '등록 상태',
    enum: ['ACTIVE', 'PENDING_REVIEW', 'UNDER_REVIEW', 'REJECTED'],
    example: 'PENDING_REVIEW',
  })
  status!: 'ACTIVE' | 'PENDING_REVIEW' | 'UNDER_REVIEW' | 'REJECTED';

  @ApiProperty({
    description: '심사 추적 ID (BNPL의 경우)',
    example: 'consent_01HQZX8QJKMNPQRST9VWXY012',
    required: false,
  })
  consentId?: string;

  @ApiProperty({
    description: '예상 심사 기간 (일, BNPL의 경우)',
    example: 3,
    required: false,
  })
  expectedReviewDays?: number;

  @ApiProperty({
    description: '등록 시간',
    example: '2024-01-15T10:00:00Z',
  })
  registeredAt!: string;

  @ApiProperty({
    description: '오류 메시지 (실패 시)',
    example: '카드 정보가 유효하지 않습니다',
    required: false,
  })
  error?: string;

  @ApiProperty({
    description: 'Provider별 추가 정보',
    example: {
      hmsMemberId: 'hms_member_12345',
      reviewMessage:
        '출금동의서가 접수되었습니다. 2-3일 내 심사 완료 예정입니다.',
    },
    required: false,
  })
  metadata?: Record<string, any>;
}

/**
 * 출금동의서 상태 조회 DTO
 */
export class ConsentStatusResponseDto {
  @ApiProperty({
    description: '출금동의서 ID',
    example: 'consent_01HQZX8QJKMNPQRST9VWXY012',
  })
  consentId!: string;

  @ApiProperty({
    description: '심사 상태',
    enum: ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED'],
    example: 'UNDER_REVIEW',
  })
  status!: 'SUBMITTED' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED';

  @ApiProperty({
    description: '제출 시간',
    example: '2024-01-15T10:00:00Z',
  })
  submittedAt!: string;

  @ApiProperty({
    description: '심사 완료 시간 (완료된 경우)',
    example: '2024-01-17T14:30:00Z',
    required: false,
  })
  reviewedAt?: string;

  @ApiProperty({
    description: '승인 시간 (승인된 경우)',
    example: '2024-01-17T14:30:00Z',
    required: false,
  })
  approvedAt?: string;

  @ApiProperty({
    description: '거절 사유 (거절된 경우)',
    example: '제출된 서류가 불충분합니다',
    required: false,
  })
  rejectionReason?: string;

  @ApiProperty({
    description: '프로필 생성 가능 여부',
    example: true,
  })
  canCreateProfile!: boolean;

  @ApiProperty({
    description: '다음 액션',
    enum: ['WAIT', 'CREATE_PROFILE', 'RESUBMIT', 'CONTACT_SUPPORT'],
    example: 'CREATE_PROFILE',
    required: false,
  })
  nextAction?: 'WAIT' | 'CREATE_PROFILE' | 'RESUBMIT' | 'CONTACT_SUPPORT';

  @ApiProperty({
    description: '추가 정보',
    example: {
      reviewerComments: '추가 서류 제출이 필요합니다',
      expectedCompletionDate: '2024-01-18',
    },
    required: false,
  })
  metadata?: Record<string, any>;
}
