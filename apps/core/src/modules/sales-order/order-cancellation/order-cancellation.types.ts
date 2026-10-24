import type { CancelRequestView } from '../channel-cancel-request/channel-cancel-request.types';

/** 취소할 줄과 수량. 없으면(요청에 `lines` 가 없으면) 전체취소다 */
export type CancelLine = { salesOrderLineId: string; quantity: number };

/**
 * 취소 «요청» — 고객(스토어프론트)·운영자(관리자) 문이 커널에 말하는 것 (K7 PR1).
 * 호출자는 누가·무엇을·왜만 말하고, 채널 판정·키·재전송·인쇄 gate·확정 순서는 커널이 정한다.
 */
export type CancellationRequest =
  | {
      requester: { kind: 'customer'; customerId: string };
      salesOrderId: string;
      sourceKey: string | undefined;
      reasonCode?: string;
      reasonDetail?: string;
      /** 고객이 인쇄 상품을 빼고 나머지만 취소하겠다고 동의한 두 번째 요청 */
      excludePrint?: boolean;
    }
  | {
      requester: { kind: 'operator'; actorId: string };
      /** core 정산 주문의 출고 명령 행위자 권한 — 문이 넘긴다(채널 요청은 쓰지 않는다) */
      actorRoles: string[];
      salesOrderId: string;
      sourceKey: string | undefined;
      reasonCode?: string;
      reasonDetail?: string;
      lines?: CancelLine[];
      /** 부분취소만. 이번 취소 품목에 이미 다른 경로로 돌려준 금액(원) — 채널이 상계한다(#1016 37번) */
      alreadyRefundedAmount?: number;
    };

/**
 * 요청의 결과 (K7 PR4). 채널 주문은 채널에 낸 취소 요청(지금과 같은 view), core 가 돈을 쥔 주문은 core 가 바로 적용한 취소.
 * `replayed` — core 정산 주문에 같은 키가 다시 왔다(첫 결과의 지금 상태는 문이 읽는다).
 */
export type CancellationOutcome =
  | { kind: 'channel_request'; view: CancelRequestView }
  | { kind: 'replayed' }
  | { kind: 'applied'; scope: 'full' | 'partial'; refund: CancellationRefundResult };

/** core 정산 주문 취소가 남긴 환불. 즉시 환불을 커밋 뒤 실행했으면 그 Wallet 결과, 아니면 취소와 함께 기록한 상태 */
export type CancellationRefundResult = {
  refundStatus: string;
  /** 부분취소 — 비례 배분 추정액(관리자가 검토 후 결정) */
  refundEstimateAmount?: number;
  manualReason?: string;
};

/**
 * 무통장 환불 승인 통보 — 돈은 wallet 에서 이미 나갔다 (K7 PR2, N7).
 * 취소가 이미 정해진 뒤의 통보는 소스마다 커널의 문이 따로다 — 채널 취소(채널이 이미 취소했다)는
 * `receiveChannelCancellation`, 채널 수량 감소(채널이 이미 줄였다)는 `noticeChannelDecrease`.
 */
export type WalletApprovalNotice = { salesOrderId: string; intentId: string; reasonCode: string };

/** 채널 취소 통보 (K7 PR2, N7) */
export type ChannelCancelledNotice = {
  salesOrderId: string;
  /** 없으면 전체취소 */
  lines: CancelLine[] | undefined;
  reasonCode?: string;
  reasonDetail?: string;
  cancelledBy?: string;
  occurredAt?: string;
  metadata: Record<string, unknown>;
};

/** 컨슈머가 수신 트랜잭션에서 판정한 것. 재수신이면 since = 그 이벤트를 처음 기록한 시각 */
export type ChannelCancellationReceipt =
  | { notice: ChannelCancelledNotice }
  | { redelivered: { salesOrderId: string; lines: CancelLine[] | undefined; since: Date | undefined } };

/** 채널 수량 감소 통보 (K7 PR2, D7). 수신 트랜잭션(변경 기록과 한 묶음) 안에서만 받는다 */
export type ChannelDecreaseNotice = {
  salesOrderId: string;
  line: CancelLine;
  reasonCode: string;
  occurredAt: string;
  sourceEventId: string;
  /** false = 채널 변경 규칙이 이미 대기로 정했다 — 인쇄만 붙잡고 시도하지 않는다 */
  attempt: boolean;
};

export type DecreaseOutcome = { applied: true } | { applied: false; refusal: string };
