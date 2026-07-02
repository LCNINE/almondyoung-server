import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RefundStatus } from '../../schema';

export class RefundReceiveAccountDto {
  @ApiProperty({ description: '토스 2자리 은행코드 (예: 국민 06)' })
  @IsString()
  @IsNotEmpty()
  bank: string;

  @ApiProperty({ description: '환불받을 계좌번호 (숫자만)' })
  @IsString()
  @IsNotEmpty()
  accountNumber: string;

  @ApiProperty({ description: '예금주명 (토스가 실명 검증)' })
  @IsString()
  @IsNotEmpty()
  holderName: string;
}

export class CreateRefundDto {
  @ApiProperty({ description: 'Charge ID to refund against' })
  @IsString()
  @IsNotEmpty()
  chargeId: string;

  @ApiProperty({ description: 'Amount to refund (positive integer)', minimum: 1 })
  @IsInt()
  @Min(1)
  amount: number;

  @ApiPropertyOptional({ description: 'Expected intent ID — validated against charge.intentId when provided' })
  @IsOptional()
  @IsString()
  intentId?: string;

  @ApiPropertyOptional({ description: 'Reason code', maxLength: 128 })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  reasonCode?: string;

  @ApiPropertyOptional({ description: 'Reason message' })
  @IsOptional()
  @IsString()
  reasonMessage?: string;

  @ApiPropertyOptional({
    description: '멤버십 결제 환불 차단을 우회 (admin 강제취소 예외 환불 전용). 일반/셀프 환불에서는 절대 설정 금지.',
  })
  @IsOptional()
  @IsBoolean()
  allowMembershipRefund?: boolean;

  @ApiPropertyOptional({
    description: '무통장(가상계좌) 입금 후 환불받을 계좌. 제공 시 토스가 해당 계좌로 자동 송금.',
    type: RefundReceiveAccountDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => RefundReceiveAccountDto)
  refundReceiveAccount?: RefundReceiveAccountDto;
}

export class CreateRefundRequestDto {
  @ApiProperty({ description: '환불 신청할 결제 인텐트 ID' })
  @IsString()
  @IsNotEmpty()
  intentId: string;

  @ApiProperty({ description: '토스 2자리 은행코드 (예: 국민 06)' })
  @IsString()
  @IsNotEmpty()
  bankCode: string;

  @ApiPropertyOptional({ description: '은행 표시명' })
  @IsOptional()
  @IsString()
  bankName?: string;

  @ApiProperty({ description: '환불받을 계좌번호' })
  @IsString()
  @IsNotEmpty()
  accountNumber: string;

  @ApiProperty({ description: '예금주명 (토스 실명 검증)' })
  @IsString()
  @IsNotEmpty()
  holderName: string;

  @ApiPropertyOptional({ description: '환불 사유' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class RefundRequestActionDto {
  @ApiPropertyOptional({ description: '관리자 처리 메모' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  adminNote?: string;
}

export class RefundResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  chargeId: string;

  @ApiProperty()
  intentId: string;

  @ApiProperty()
  status: RefundStatus;

  @ApiProperty()
  amount: number;

  @ApiProperty()
  currency: string;

  @ApiPropertyOptional()
  reasonCode: string | null;

  @ApiPropertyOptional()
  reasonMessage: string | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({ description: '수동 완료 처리 가능 여부 (무통장 환불만 true)' })
  manualConfirmable: boolean;
}
