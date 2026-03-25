import { IsString, IsOptional, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SubmitForAuditDto {
  @ApiProperty({
    description: '제출 메모 (Submission notes)',
    required: false,
    example: 'Please review this purchase order for approval',
  })
  @IsString()
  @IsOptional()
  notes?: string;
}

export class ApprovePoDto {
  @ApiProperty({
    description: '승인 메모 (Approval notes)',
    required: false,
    example: 'Approved - all items verified',
  })
  @IsString()
  @IsOptional()
  approvalNotes?: string;
}

export class RejectPoDto {
  @ApiProperty({
    description: '거부 사유 (Rejection reason)',
    required: true,
    example: 'SKU quantities exceed budget limits',
  })
  @IsString()
  @IsNotEmpty()
  rejectionReason: string;
}
