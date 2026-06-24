import { ApiProperty } from '@nestjs/swagger';
import {
  type CsCaseEventType,
  type CsCasePriority,
  type CsCaseSourceChannel,
  type CsCaseStatus,
} from '../schema/customer-service.schema';

export class CsCaseTimelineItemDto {
  @ApiProperty({ description: '항목 종류', enum: ['comment', 'event', 'business_link'] })
  kind: 'comment' | 'event' | 'business_link';

  @ApiProperty({ description: '항목 ID' })
  id: string;

  @ApiProperty({ description: '발생 시각' })
  occurredAt: Date;

  @ApiProperty({ description: '행위자(작성자/실행자) ID', nullable: true })
  actorId: string | null;

  @ApiProperty({ description: 'comment: 본문(소프트삭제면 null)', nullable: true, required: false })
  body?: string | null;

  @ApiProperty({ description: 'comment: 삭제 여부', required: false })
  deleted?: boolean;

  @ApiProperty({ description: 'comment: 수정 여부', required: false })
  edited?: boolean;

  @ApiProperty({ description: 'comment: 멘션된 사용자 ID 목록', required: false, type: [String] })
  mentions?: string[];

  @ApiProperty({ description: 'comment: 첨부 file-service ID 목록', required: false, type: [String] })
  attachmentFileIds?: string[];

  @ApiProperty({
    description: 'event: 이벤트 종류',
    enum: ['status_changed', 'assigned', 'unassigned', 'label_added', 'label_removed'],
    required: false,
  })
  eventType?: CsCaseEventType;

  @ApiProperty({ description: 'event/business_link: payload', required: false })
  payload?: Record<string, unknown>;
}

export class CsCaseResponseDto {
  @ApiProperty({ description: 'CS Case ID' })
  id: string;

  @ApiProperty({ description: '상태', enum: ['open', 'pending', 'closed'] })
  status: CsCaseStatus;

  @ApiProperty({ description: '우선순위', enum: ['low', 'normal', 'high', 'urgent'] })
  priority: CsCasePriority;

  @ApiProperty({ description: 'CS Case 제목' })
  subject: string;

  @ApiProperty({ description: '상세 설명', nullable: true })
  description: string | null;

  @ApiProperty({ description: '유입 채널', enum: ['kakao', 'web_messenger', 'manual'] })
  sourceChannel: CsCaseSourceChannel;

  @ApiProperty({ description: '외부 대화 포인터', nullable: true })
  externalThreadRef: string | null;

  @ApiProperty({ description: '고객 ID', nullable: true })
  customerId: string | null;

  @ApiProperty({ description: '고객명', nullable: true })
  customerName: string | null;

  @ApiProperty({ description: '담당자 ID', nullable: true })
  assignedTo: string | null;

  @ApiProperty({ description: '부가 정보' })
  metadata: Record<string, unknown>;

  @ApiProperty({ description: '생성자 ID', nullable: true })
  createdBy: string | null;

  @ApiProperty({ description: '종결 시각', nullable: true })
  closedAt: Date | null;

  @ApiProperty({ description: '생성 일시' })
  createdAt: Date;

  @ApiProperty({ description: '수정 일시' })
  updatedAt: Date;

  @ApiProperty({ description: '적용된 라벨 ID 목록', type: [String] })
  labelIds: string[];

  @ApiProperty({ description: '시간순 통합 타임라인', type: [CsCaseTimelineItemDto] })
  timeline: CsCaseTimelineItemDto[];
}
