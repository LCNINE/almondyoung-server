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
      salesOrderId: string;
      sourceKey: string | undefined;
      reasonCode?: string;
      reasonDetail?: string;
      lines?: CancelLine[];
      /** 부분취소만. 이번 취소 품목에 이미 다른 경로로 돌려준 금액(원) — 채널이 상계한다(#1016 37번) */
      alreadyRefundedAmount?: number;
    };

/**
 * 취소 «통보» — 취소가 이미 정해진 뒤 커널에 알리는 것 (K7 PR1).
 * 무통장 승인(돈은 wallet 에서 이미 나갔다)·채널 취소(채널이 이미 취소했다).
 * 채널 수량 감소(채널이 이미 줄였다)는 제 문(`noticeChannelDecrease`)으로 받는다 — `ChannelDecreaseNotice`.
 */
export type CancellationNotice =
  | { source: 'wallet_refund_approval'; salesOrderId: string; intentId: string; reasonCode: string }
  | {
      source: 'channel_cancelled';
      salesOrderId: string;
      /** 없으면 전체취소 */
      lines: CancelLine[] | undefined;
      reasonCode?: string;
      reasonDetail?: string;
      cancelledBy?: string;
      occurredAt?: string;
      metadata: Record<string, unknown>;
    };

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

/** 통보한 트랜잭션이 커밋된 뒤 커널이 할 일. 호출자는 이걸 `afterCommit` 에 그대로 돌려준다 */
export type NoticeFollowUp = { salesOrderId: string; lines: CancelLine[] | undefined; redeliveredSince?: Date };

export type NoticeOutcome =
  | { applied: true; requestView?: CancelRequestView; followUp?: NoticeFollowUp }
  | { applied: false; refusal: string };
