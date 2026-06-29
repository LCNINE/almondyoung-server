import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RefundStatus } from '../../schema';

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
