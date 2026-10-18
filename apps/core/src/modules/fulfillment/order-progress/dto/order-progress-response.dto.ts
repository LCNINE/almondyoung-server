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

export class OrderProgressSettlementFailureDto {
  @ApiProperty() code!: string;
  @ApiProperty({ description: '채널이 준 문장 그대로(wallet 거절은 토스 한국어 메시지)' }) message!: string;
  @ApiProperty() retryable!: boolean;
  @ApiProperty() at!: string;
}

export class OrderProgressSettlementDto {
  @ApiProperty() requestId!: string;
  @ApiProperty({ enum: ['in_progress', 'delayed', 'refused'] }) phase!: string;
  @ApiProperty({ enum: ['auto', 'manual'] }) mode!: string;
  @ApiProperty({ description: '확정 시각' }) confirmedAt!: string;
  @ApiProperty({ description: '이번 정산 시도의 시작 — [다시 시도]·[계좌 송금]마다 새로 찍힌다' }) startedAt!: string;
  @ApiProperty({ description: '3영업일 기한(주말 제외)' }) deadlineAt!: string;
  @ApiProperty({ nullable: true, type: OrderProgressSettlementFailureDto })
  lastFailure!: OrderProgressSettlementFailureDto | null;
}

export class ReserveShortageItemDto {
  @ApiProperty() skuId!: string;
  @ApiProperty() skuName!: string;
  @ApiProperty({ description: '이 SKU 의 부족 수량(상자 라인 수량 − 확정 예약, 라인 합)' }) shortQty!: number;
  @ApiProperty({
    nullable: true,
    type: String,
    description: '열린 발주 중 가장 이른 도착예정일(YYYY-MM-DD). 없으면 null',
  })
  expectedArrival!: string | null;
}

export class ReserveShortageDto {
  @ApiProperty({ description: '대표 상자(가장 오래된 덜 예약된 draft 상자)' }) shipmentId!: string;
  @ApiProperty({ description: 'split-unreserved 의 expectedManifestVersion 으로 보낸다' }) manifestVersion!: number;
  @ApiProperty({ description: '다른 판매주문 라인을 가진 합포장 상자 — 화면이 나눠 보내기를 막는다' })
  consolidated!: boolean;
  @ApiProperty({
    description:
      '대표 상자에 확정 예약이 하나라도 있다. false 면 나눠도 남는 몫이 없어(전부 미예약) 화면이 버튼을 내지 않는다',
  })
  splittable!: boolean;
  @ApiProperty({ description: '대표 상자의 SKU 종 수' }) skuKinds!: number;
  @ApiProperty({ description: '그중 덜 예약된 종 수' }) shortSkuKinds!: number;
  @ApiProperty({ type: [ReserveShortageItemDto], description: 'SKU 별 합, 부족 수량 큰 순' })
  items!: ReserveShortageItemDto[];
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
  @ApiProperty({
    nullable: true,
    type: OrderProgressSettlementDto,
    description: '취소 요청 단계의 정산 중 요청(가장 나쁜 것). 그 밖은 null',
  })
  settlement!: OrderProgressSettlementDto | null;
  @ApiProperty({ nullable: true, type: String }) walletIntentId!: string | null;
  @ApiProperty({
    nullable: true,
    type: ReserveShortageDto,
    description: '예약 단계의 부족 품목·입고 예정. 그 밖 단계이거나 덜 예약된 상자가 없으면 null',
  })
  shortage!: ReserveShortageDto | null;
}

export class OrderProgressPageDto {
  @ApiProperty({ type: [OrderProgressItemDto] }) items!: OrderProgressItemDto[];
  @ApiProperty({ nullable: true, type: String }) nextCursor!: string | null;
}
