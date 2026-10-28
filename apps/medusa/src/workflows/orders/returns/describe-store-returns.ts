import { readReturnPrepayRecord } from './return-prepay-record';
import { readReturnRequestRecord } from './load-return-order';
import { readReturnSettlementRecord } from './return-settlement-record';

/** 고객이 보는 반품 단계(K8 PR8 N2). 회수 대기·창고 도착·검수 중은 가르지 않는다 — core 를 부르지 않는다. */
export type StoreReturnStage = 'requested' | 'processing' | 'refunded' | 'canceled';

export type StoreReturnSource = {
  id: string;
  status: string;
  requestedAt: string | null;
  createdAt: string;
  metadata: unknown;
  items: Array<{ itemId: string; quantity: number }>;
};

export type StoreReturnView = {
  returnId: string;
  stage: StoreReturnStage;
  requestedAt: string;
  reason: string;
  feeBearer: 'customer' | 'seller';
  items: Array<{ itemId: string; quantity: number }>;
  canCancel: boolean;
};

const PROCESSING_STATUSES: ReadonlySet<string> = new Set(['received', 'partially_received']);

function stageOf(r: StoreReturnSource): StoreReturnStage {
  if (r.status === 'canceled') return 'canceled';
  if (
    readReturnSettlementRecord(r.metadata)?.stage === 'refunded' ||
    readReturnPrepayRecord(r.metadata)?.stage === 'refunded'
  )
    return 'refunded';
  if (PROCESSING_STATUSES.has(r.status) || readReturnSettlementRecord(r.metadata)) return 'processing';
  return 'requested';
}

/**
 * 주문의 반품들을 고객 목록 모양으로 옮긴다. 우리 기록(almondReturn)이 있는 반품만, open(끊긴 시도)은 뺀다.
 * 늦게 요청한 순. 취소 가능 여부는 Medusa 상태까지만 안다 — core 도착은 취소 POST 가 거절한다.
 */
export function describeStoreReturns(returns: StoreReturnSource[]): StoreReturnView[] {
  const views = returns.flatMap((r) => {
    const record = readReturnRequestRecord(r.metadata);
    if (!record || r.status === 'open') return [];
    const stage = stageOf(r);
    const view: StoreReturnView = {
      returnId: r.id,
      stage,
      requestedAt: r.requestedAt ?? r.createdAt,
      reason: record.reasonValue,
      feeBearer: record.feeBearer,
      items: r.items.map((i) => ({ itemId: i.itemId, quantity: i.quantity })),
      canCancel: stage === 'requested' && r.status === 'requested',
    };
    return [view];
  });
  return views.sort((a, b) => Date.parse(b.requestedAt) - Date.parse(a.requestedAt));
}
