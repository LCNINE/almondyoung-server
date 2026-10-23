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
