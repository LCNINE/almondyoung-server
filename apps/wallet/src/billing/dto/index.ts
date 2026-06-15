import { IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ─── Billing Method DTOs ────────────────────────────────────────────────────

export class IssueTossBillingKeyDto {
  @ApiProperty({ description: 'Toss authKey from client SDK' })
  @IsString()
  @IsNotEmpty()
  authKey: string;

  @ApiProperty({ description: 'Toss customerKey (unique per user)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  customerKey: string;
}

export class IssueNicepayBillingKeyDto {
  @ApiProperty({
    description: 'AES 암호화된 카드정보 (encData). 프론트에서 NicePay SecretKey로 암호화하여 전달',
  })
  @IsString()
  @IsNotEmpty()
  encData: string;

  @ApiProperty({ description: '상점 거래 고유번호 (가맹점 관리 Unique 값)', maxLength: 64 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  orderId: string;

  @ApiPropertyOptional({
    description: '암호화 모드. A2=AES-256/CBC, 미입력=AES-128/ECB(기본)',
    enum: ['A2'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['A2'])
  encMode?: string;

  @ApiPropertyOptional({ description: '구매자 이름', maxLength: 30 })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  buyerName?: string;

  @ApiPropertyOptional({ description: '구매자 이메일', maxLength: 60 })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  buyerEmail?: string;

  @ApiPropertyOptional({ description: '구매자 전화번호 (숫자만)', maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  buyerTel?: string;
}

export class RegisterCmsBillingMethodDto {
  @ApiProperty({ description: 'CMS member ID from 효성' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  cmsMemberId: string;

  @ApiProperty({ description: 'Display name (e.g. "국민은행 ****1234")' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  displayName?: string;
}

export class CmsBankAccountDto {
  @ApiProperty({ description: '은행코드 3자리 (예: 004=국민, 088=신한)', example: '004' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{3}$/, { message: 'paymentCompany must be a 3-digit bank code' })
  @MaxLength(3)
  paymentCompany: string;

  @ApiProperty({ description: '예금주명', maxLength: 15 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(15)
  payerName: string;

  @ApiProperty({ description: '생년월일 6자리(YYMMDD) 또는 사업자번호 10자리', maxLength: 10 })
  @IsString()
  @IsNotEmpty()
  @Matches(/^(\d{6}|\d{10})$/, { message: 'payerNumber must be 6 or 10 digits' })
  @MaxLength(10)
  payerNumber: string;

  @ApiProperty({ description: '계좌번호 (숫자만)', maxLength: 16 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(16)
  paymentNumber: string;

  @ApiProperty({ description: '연락처 (숫자만)', maxLength: 20 })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{8,20}$/, { message: 'phone must contain 8 to 20 digits' })
  @MaxLength(20)
  phone: string;
}

export class BillingMethodResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  userId: string;

  @ApiProperty()
  providerType: string;

  @ApiProperty()
  displayName: string | null;

  @ApiProperty()
  method: Record<string, unknown> | null;

  @ApiProperty()
  status: string;

  @ApiProperty()
  expiresAt: Date | null;

  @ApiProperty()
  createdAt: Date;
}

export class RegisterCmsWithAgreementResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  userId: string;

  @ApiProperty()
  providerType: string;

  @ApiProperty()
  displayName: string | null;

  @ApiProperty()
  status: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({ description: 'CMS 회원 ID (효성)' })
  cmsMemberId: string;

  @ApiProperty({ description: '심사 상태 (PENDING · REGISTERED · FAILED)' })
  cmsMemberStatus: string;

  @ApiProperty({ description: '동의자료 상태 (등록 · 실패 · null)' })
  agreementStatus: string | null;

  @ApiProperty({ description: '동의자료 업로드 실패 여부. true이면 관리자 처리 필요' })
  agreementUploadFailed: boolean;
}

export class CmsBillingMethodStatusDto {
  @ApiProperty({ description: 'billing_methods.id' })
  billingMethodId: string;

  @ApiProperty()
  userId: string;

  @ApiProperty()
  providerType: string;

  @ApiProperty()
  displayName: string | null;

  @ApiProperty({ enum: ['ACTIVE', 'REVOKED', 'DELETED', 'EXPIRED'] })
  billingMethodStatus: string;

  @ApiProperty({ description: '효성 CMS 회원 ID', nullable: true })
  cmsMemberId: string | null;

  @ApiProperty({ enum: ['PENDING', 'REGISTERED', 'FAILED', 'DELETED'] })
  cmsMemberStatus: string;

  @ApiProperty({ description: '동의자료 최신 상태 (등록·실패·null)', nullable: true })
  agreementStatus: string | null;

  @ApiProperty({ description: 'true이면 정기결제 수단으로 선택 가능 (REGISTERED + 동의자료 등록 + ACTIVE)' })
  isSelectableForRecurringBilling: boolean;

  @ApiProperty({ description: '고객 표시용 상태 레이블' })
  statusLabel: string;

  @ApiProperty({ nullable: true })
  resultCode: string | null;

  @ApiProperty({ nullable: true })
  resultMessage: string | null;

  @ApiProperty({ nullable: true })
  paymentCompany: string | null;

  @ApiProperty({ nullable: true })
  payerName: string | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

// ─── Billing Agreement DTOs ─────────────────────────────────────────────────

export class CreateBillingAgreementDto {
  @ApiProperty({ description: 'User ID' })
  @IsUUID()
  userId: string;

  @ApiProperty({ description: 'Subscriber reference (e.g. contractId)' })
  @IsString()
  @IsNotEmpty()
  subscriberRef: string;

  @ApiProperty({ description: 'Subscriber type (e.g. MEMBERSHIP)' })
  @IsString()
  @IsNotEmpty()
  subscriberType: string;

  @ApiPropertyOptional({ description: 'Specific billing method ID. If omitted, uses the latest active method.' })
  @IsOptional()
  @IsUUID()
  billingMethodId?: string;
}

export class DirectBillingChargeDto {
  @ApiProperty({ description: 'User ID' })
  @IsUUID()
  userId: string;

  @ApiProperty({ description: 'Billing method ID to charge' })
  @IsUUID()
  billingMethodId: string;

  @ApiProperty({ description: 'Amount to charge' })
  @IsNotEmpty()
  amount: number;

  @ApiPropertyOptional({ description: 'Currency (default: KRW)' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({ description: 'Purpose (default: SUBSCRIPTION)' })
  @IsOptional()
  @IsString()
  purpose?: string;

  @ApiPropertyOptional({ description: 'Metadata' })
  @IsOptional()
  metadata?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Idempotency key' })
  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}

export class UpdateBillingMethodDto {
  @ApiProperty({ description: 'New billing method ID' })
  @IsUUID()
  billingMethodId: string;
}

export class BillingAgreementResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  userId: string;

  @ApiProperty()
  billingMethodId: string;

  @ApiProperty()
  subscriberRef: string;

  @ApiProperty()
  subscriberType: string;

  @ApiProperty()
  status: string;

  @ApiProperty()
  createdAt: Date;
}
