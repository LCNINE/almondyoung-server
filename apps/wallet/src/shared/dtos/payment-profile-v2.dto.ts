// payment-profile-v2.dto.ts - 정규화된 스키마용 DTO
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsIn,
  IsInt,
  Min,
  Max,
  Length,
  Matches,
} from 'class-validator';

/**
 * 결제프로필 생성 요청 DTO (정규화된 구조)
 */
export class PaymentProfileCreateV2RequestDto {
  @IsString()
  @IsNotEmpty()
  userId!: string;

  @IsString()
  @IsIn(['CARD', 'BATCH'])
  kind!: 'CARD' | 'BATCH';

  @IsString()
  @IsOptional()
  @Length(1, 64)
  name?: string; // UI 라벨

  // === CMS 카드 전용 필드 ===
  @IsString()
  @IsOptional()
  @Matches(/^\d{13,19}$/)
  paymentNumber?: string; // 카드번호 (처리 후 저장 안함)

  @IsString()
  @IsOptional()
  @Matches(/^\d{4}$/)
  validUntil?: string; // MMYY (처리 후 저장 안함)

  @IsString()
  @IsOptional()
  @Matches(/^\d{2}$/)
  password?: string; // 앞 2자리 (처리 후 저장 안함)

  // === CMS 배치 전용 필드 ===
  @IsString()
  @IsOptional()
  @Matches(/^\d{10,16}$/)
  accountNumber?: string; // 계좌번호 (처리 후 저장 안함)

  // === 공통 필드 ===
  @IsString()
  @IsOptional()
  @Matches(/^01[0-9]-?\d{3,4}-?\d{4}$/)
  phone?: string; // 마스킹 후 저장

  @IsString()
  @IsOptional()
  @Length(2, 64)
  payerName?: string; // 결제자명 (마스킹 후 저장)

  @IsString()
  @IsOptional()
  @Matches(/^\d{6}$/)
  payerNumber?: string; // 생년월일 (처리 후 저장 안함)

  @IsString()
  @IsOptional()
  @Length(3, 3)
  paymentCompany?: string; // 카드사/은행 코드

  @IsInt()
  @IsOptional()
  @Min(1)
  @Max(31)
  billingDay?: number; // 결제일
}

/**
 * 결제프로필 응답 DTO (정규화된 구조)
 */
export class PaymentProfileV2ResponseDto {
  profileId!: string;
  userId!: string;
  provider!: 'CMS';
  kind!: 'CARD' | 'BATCH';
  status!: 'PENDING' | 'ACTIVE' | 'INACTIVE';
  name?: string;
  createdAt!: string;
  updatedAt!: string;

  // CMS 상세 정보
  memberId!: string;
  cmsStatus!: string;
  paymentCompany?: string;

  // UX 요약 정보 (민감값 제외)
  cardLast4?: string; // 카드만
  cardBrand?: string; // 카드만
  payerName?: string;
  phoneMask?: string;
  billingDay?: number;
}

/**
 * 결제프로필 상태 업데이트 DTO
 */
export class PaymentProfileStatusUpdateDto {
  @IsString()
  @IsIn(['PENDING', 'ACTIVE', 'INACTIVE'])
  status!: 'PENDING' | 'ACTIVE' | 'INACTIVE';

  @IsString()
  @IsOptional()
  reason?: string;
}

/**
 * CMS 상태 업데이트 DTO (내부용)
 */
export class CmsStatusUpdateDto {
  @IsString()
  @IsNotEmpty()
  memberId!: string;

  @IsString()
  @IsNotEmpty()
  cmsStatus!: string;

  @IsString()
  @IsOptional()
  errorMessage?: string;
}
