import { IsIn, IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CashReceiptStatus, CashReceiptType } from '../../schema';

export class IssueCashReceiptDto {
  @ApiProperty({ description: '현금영수증을 발급할 결제 인텐트 ID' })
  @IsString()
  @IsNotEmpty()
  intentId: string;

  @ApiProperty({ description: '소득공제(개인) 또는 지출증빙(사업자)', enum: ['소득공제', '지출증빙'] })
  @IsIn(['소득공제', '지출증빙'])
  type: CashReceiptType;

  @ApiProperty({
    description: '소득공제: 휴대폰번호, 지출증빙: 사업자등록번호 (숫자만, 하이픈 제거)',
    maxLength: 30,
  })
  @IsString()
  @Matches(/^[0-9]{8,30}$/, { message: 'customerIdentityNumber must be 8-30 digits' })
  customerIdentityNumber: string;
}

export class CashReceiptResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  intentId: string;

  @ApiProperty()
  type: CashReceiptType;

  @ApiProperty()
  status: CashReceiptStatus;

  @ApiProperty()
  amount: number;

  @ApiProperty()
  currency: string;

  @ApiPropertyOptional({ description: '토스 영수증 조회 URL' })
  receiptUrl: string | null;

  @ApiPropertyOptional({ description: '국세청 발급번호' })
  issueNumber: string | null;

  @ApiPropertyOptional()
  errorMessage: string | null;

  @ApiProperty()
  createdAt: Date;
}
