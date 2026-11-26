const REFUND_LINK_RELATION = 'cancellation_linked_wallet_refund';
/** 이 상태의 링크가 자기 completedRefundLinkId 가 가리키는 manual_pending 을 닫는다 */
const CLOSING_STATUSES = ['succeeded', 'waived'];

interface TimelineLike {
  id?: string;
  relationName?: string;
  createdAt?: string | Date;
  metadata?: Record<string, unknown> | null;
}

export interface RefundOfTimeline {
  refundStatus?: string;
  /** 결정·수동완료 대상 manual_pending 링크 id (닫히지 않은 것만) */
  refundLinkId?: string;
  refundEstimateAmount?: number;
  manualReason?: string;
  /** 환불 실행/안 함을 운영자가 골라야 하는 상태 */
  awaitingDecision: boolean;
  needsBalanceReconciliation?: boolean;
}

export function refundOfTimeline(timeline: TimelineLike[]): RefundOfTimeline {
  const links = timeline
    .filter((t) => t.relationName === REFUND_LINK_RELATION)
    .sort(
      (a, b) =>
        new Date(b.createdAt ?? 0).getTime() -
        new Date(a.createdAt ?? 0).getTime()
    );

  const closedIds = new Set<string>(
    links
      .filter(
        (t) =>
          CLOSING_STATUSES.includes(String(t.metadata?.refundStatus)) &&
          typeof t.metadata?.completedRefundLinkId === 'string'
      )
      .map((t) => t.metadata!.completedRefundLinkId as string)
  );
  const pendingLink = links.find(
    (t) =>
      t.metadata?.refundStatus === 'manual_pending' &&
      !closedIds.has(t.id ?? '')
  );
  const latest = links[0];
  const needsBalanceReconciliation =
    latest?.metadata?.refundStatus === 'failed' &&
    ['REFUND_AMOUNT_EXCEEDS_AVAILABLE', 'REFUND_AMOUNT_EXCEEDS_TOTAL'].includes(
      String(latest.metadata?.errorCode)
    );
  const effective = needsBalanceReconciliation
    ? latest
    : (pendingLink ?? latest);
  const estimate = pendingLink?.metadata?.refundEstimateAmount;
  const refundStatus = effective?.metadata?.refundStatus as string | undefined;

  return {
    refundStatus,
    refundLinkId:
      pendingLink?.id ?? (needsBalanceReconciliation ? latest?.id : undefined),
    refundEstimateAmount: typeof estimate === 'number' ? estimate : undefined,
    manualReason: pendingLink?.metadata?.manualReason as string | undefined,
    awaitingDecision:
      refundStatus === 'requested' ||
      (refundStatus === 'manual_pending' &&
        effective?.metadata?.awaitingDecision === true),
    ...(needsBalanceReconciliation ? { needsBalanceReconciliation: true } : {}),
  };
}
