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

// 아래 응답 DTO 셋은 컨트롤러가 각 엔드포인트마다 인라인 `schema: { type: 'object', ... }`
// 로 때우던 자리를 대신한다 — CLAUDE.md 가 금지한 형태다.

export class SubmitForAuditResponseDto {
  @ApiProperty({ example: 'uuid' }) id: string;
  @ApiProperty({ example: 'pending_audit' }) auditStatus: string;
  @ApiProperty() submittedAt: Date;
  @ApiProperty({ example: '검토 요청이 제출되었습니다. (Submitted for audit)' }) message: string;
}

export class ApprovePoResponseDto {
  @ApiProperty({ example: 'uuid' }) id: string;
  @ApiProperty({ example: 'approved' }) auditStatus: string;
  @ApiProperty() approvedAt: Date;
  @ApiProperty({ example: '발주가 승인되었습니다. (Purchase order approved)' }) message: string;
}

export class RejectPoResponseDto {
  @ApiProperty({ example: 'uuid' }) id: string;
  @ApiProperty({ example: 'draft' }) auditStatus: string;
  @ApiProperty() rejectedAt: Date;
  @ApiProperty({ example: 'SKU quantities exceed budget limits' }) reason: string;
  @ApiProperty({
    example: '발주가 거부되었습니다. 수정 후 재제출하세요. (Purchase order rejected, please revise and resubmit)',
  })
  message: string;
}
