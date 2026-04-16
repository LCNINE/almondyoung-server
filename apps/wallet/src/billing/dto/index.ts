import { IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
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

// ─── Billing Agreement DTOs ─────────────────────────────────────────────────

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
