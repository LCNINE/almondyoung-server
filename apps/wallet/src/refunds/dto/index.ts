import { IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  RefundExecution,
  RefundKind,
  RefundStatus,
  refundExecutionEnum,
  refundKindEnum,
  refundStatusEnum,
} from '../../schema';

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
    enum: refundKindEnum.enumValues,
    description: '무엇을 되돌린 돈인가. 생략하면 null(모름)',
  })
  @IsOptional()
  @IsIn(refundKindEnum.enumValues)
  kind?: RefundKind;

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

  @ApiProperty({
    description: '수동 완료 처리 가능 여부 (무통장 PENDING 또는 수동 실행(MANUAL) PENDING 행 — 관리자 목록·상세가 isManuallyConfirmable 로 계산)',
  })
  manualConfirmable: boolean;

  @ApiProperty({
    enum: refundExecutionEnum.enumValues,
    description: 'AUTO: wallet 이 provider 로 집행. MANUAL: 외부 결제 몫을 PG 없이 송금 대기로 둔 행',
  })
  execution: RefundExecution;

  @ApiPropertyOptional({
    enum: refundKindEnum.enumValues,
    nullable: true,
    description: '무엇을 되돌린 돈인가. null 은 모름',
  })
  kind: RefundKind | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'FAILED 일 때 실패 코드(토스 오류 코드 등). 그 밖엔 null',
  })
  failureCode: string | null;

  @ApiPropertyOptional({
    type: Boolean,
    nullable: true,
    description: 'FAILED 일 때만: 같은 환불을 다시 시도하면 될 수 있는가. null 은 분류 전 옛 행 — 일시로 읽는다',
  })
  retryable: boolean | null;
}

/** 환불 목록 한 줄 — 정산 직전 장부 맞추기(Medusa)·송금 여부 확인(core)이 읽는다(스펙 §6.2·§8.2). */
export class RefundListItemDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  chargeId: string;

  @ApiProperty({ enum: refundStatusEnum.enumValues })
  status: RefundStatus;

  @ApiProperty()
  amount: number;

  @ApiPropertyOptional({ type: String, nullable: true })
  reasonCode: string | null;

  @ApiProperty({ enum: refundExecutionEnum.enumValues })
  execution: RefundExecution;

  @ApiPropertyOptional({ enum: refundKindEnum.enumValues, nullable: true })
  kind: RefundKind | null;

  @ApiProperty()
  createdAt: Date;
}
