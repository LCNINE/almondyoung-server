import { ApiProperty } from '@nestjs/swagger';
import { SalesOrderBusinessTimelineItemDto } from '../../sales-order/dto/sales-order-response.dto';
import { type CsCasePriority, type CsCaseStatus } from '../schema/customer-service.schema';

export class CsCaseResponseDto {
  @ApiProperty({ description: 'CS Case ID' })
  id: string;

  @ApiProperty({ description: '상태', enum: ['open', 'pending', 'resolved', 'closed'] })
  status: CsCaseStatus;

  @ApiProperty({ description: '우선순위', enum: ['low', 'normal', 'high', 'urgent'] })
  priority: CsCasePriority;

  @ApiProperty({ description: '상담/처리 사유 코드', nullable: true })
  reasonCode: string | null;

  @ApiProperty({ description: 'CS Case 제목' })
  subject: string;

  @ApiProperty({ description: '상세 설명', nullable: true })
  description: string | null;

  @ApiProperty({ description: '고객 ID', nullable: true })
  customerId: string | null;

  @ApiProperty({ description: '고객명', nullable: true })
  customerName: string | null;

  @ApiProperty({ description: '고객 이메일', nullable: true })
  customerEmail: string | null;

  @ApiProperty({ description: '고객 전화번호', nullable: true })
  customerPhone: string | null;

  @ApiProperty({ description: '담당자 ID', nullable: true })
  assignedTo: string | null;

  @ApiProperty({ description: '부가 정보' })
  metadata: Record<string, unknown>;

  @ApiProperty({ description: '생성자 ID', nullable: true })
  createdBy: string | null;

  @ApiProperty({ description: '해결 시각', nullable: true })
  resolvedAt: Date | null;

  @ApiProperty({ description: '종결 시각', nullable: true })
  closedAt: Date | null;

  @ApiProperty({ description: '생성 일시' })
  createdAt: Date;

  @ApiProperty({ description: '수정 일시' })
  updatedAt: Date;

  @ApiProperty({ description: '업무 연결 timeline', type: [SalesOrderBusinessTimelineItemDto] })
  businessTimeline: SalesOrderBusinessTimelineItemDto[];
}
