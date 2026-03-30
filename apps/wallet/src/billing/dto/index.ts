import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
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
