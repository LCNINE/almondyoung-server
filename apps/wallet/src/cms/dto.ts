import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ─── CMS Member DTOs ────────────────────────────────────────────────────────

export class RegisterCmsMemberRequestDto {
  @ApiProperty({ description: '은행코드 (3자리)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(3)
  paymentCompany: string;

  @ApiProperty({ description: '납부자명' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(15)
  payerName: string;

  @ApiProperty({ description: '생년월일/사업자번호' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(10)
  payerNumber: string;

  @ApiProperty({ description: '은행 계좌번호' })
  @IsString()
  @IsNotEmpty()
  bankAccount: string;
}

export class CmsMemberResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  billingMethodId: string;

  @ApiProperty()
  userId: string;

  @ApiProperty()
  cmsMemberId: string;

  @ApiProperty()
  paymentCompany: string;

  @ApiProperty()
  payerName: string;

  @ApiProperty()
  status: string;

  @ApiProperty()
  createdAt: Date;
}

// ─── CMS Agreement DTOs ─────────────────────────────────────────────────────

export class UploadCmsAgreementDto {
  @ApiProperty({ description: 'CMS 회원 ID' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  cmsMemberId: string;

  @ApiProperty({ description: '파일 유형 (서면, 녹취, 전자서명)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(16)
  fileType: string;

  @ApiProperty({ description: '파일 확장자' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(8)
  fileExtension: string;
}

export class CmsAgreementResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  cmsMemberId: string;

  @ApiProperty()
  agreementKey: string | null;

  @ApiProperty()
  fileType: string;

  @ApiProperty()
  fileExtension: string;

  @ApiProperty()
  status: string;

  @ApiProperty()
  createdAt: Date;
}
