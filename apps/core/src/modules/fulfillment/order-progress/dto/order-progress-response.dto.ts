import { ApiProperty } from '@nestjs/swagger';
import { ORDER_PROGRESS_STAGES } from '../order-progress.thresholds';

export class OrderProgressStateSummaryDto {
  @ApiProperty() state!: string;
  @ApiProperty() open!: number;
  @ApiProperty() stuck!: number;
  @ApiProperty({ description: '리컨실러가 포기한 주문 수' }) gaveUp!: number;
}

export class OrderProgressStageSummaryDto {
  @ApiProperty({ enum: ORDER_PROGRESS_STAGES }) stage!: string;
  @ApiProperty() open!: number;
  @ApiProperty() stuck!: number;
  @ApiProperty({ description: '리컨실러가 포기한 주문 수' }) gaveUp!: number;
  @ApiProperty({ nullable: true, type: String }) oldestEnteredAt!: string | null;
  @ApiProperty({ type: [OrderProgressStateSummaryDto] }) states!: OrderProgressStateSummaryDto[];
}

export class OrderProgressSummaryResponseDto {
  @ApiProperty({ nullable: true, type: String, description: '가장 최근 판정 시각. 5분 넘게 멈추면 화면이 경고한다' })
  evaluatedAt!: string | null;
  @ApiProperty({ type: [OrderProgressStageSummaryDto] }) stages!: OrderProgressStageSummaryDto[];
}

export class OrderProgressGaveUpDto {
  @ApiProperty() rule!: string;
  @ApiProperty({ description: '#1016 행 번호' }) row!: number;
  @ApiProperty() since!: string;
  @ApiProperty({ nullable: true, type: String }) lastError!: string | null;
}

export class OrderProgressItemDto {
  @ApiProperty() salesOrderId!: string;
  @ApiProperty({ description: 'display_order_no ?? channel_order_id' }) orderNo!: string;
  @ApiProperty() channelOrderId!: string;
  @ApiProperty() salesChannel!: string;
  @ApiProperty({ nullable: true, type: String }) customerName!: string | null;
  @ApiProperty() orderedAt!: string;
  @ApiProperty({ nullable: true, type: String }) state!: string | null;
  @ApiProperty() stageEnteredAt!: string;
  @ApiProperty() stuck!: boolean;
  @ApiProperty({ type: [OrderProgressGaveUpDto] }) gaveUp!: OrderProgressGaveUpDto[];
}

export class OrderProgressPageDto {
  @ApiProperty({ type: [OrderProgressItemDto] }) items!: OrderProgressItemDto[];
  @ApiProperty({ nullable: true, type: String }) nextCursor!: string | null;
}
