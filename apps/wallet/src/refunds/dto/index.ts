import { IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';
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

  @ApiPropertyOptional({ description: 'Reason code', maxLength: 128 })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  reasonCode?: string;

  @ApiPropertyOptional({ description: 'Reason message' })
  @IsOptional()
  @IsString()
  reasonMessage?: string;
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
}
