import {
  CancelRequestStatus,
  PHASE_RANK,
  readCancelRequestLines,
  readCancelRequestMetadata,
  settlementPhase,
  toCancelRequestView,
  toSettlementView,
} from './channel-cancel-request.types';

const command = {
  requestId: 'r1',
  salesChannel: 'medusa',
  externalOrderId: 'order_1',
  scope: 'partial',
  lines: [{ channelOrderItemId: 'item_1', quantity: 1 }],
  requestedBy: 'operator',
  requestedAt: '2026-10-07T00:00:00.000Z',
};
const metadata = {
  salesChannel: 'medusa',
  externalOrderId: 'order_1',
  request: { kind: 'cancel', scope: 'partial', requestedBy: 'admin:u1', sourceKey: 'k1', command },
};

describe('취소 요청 메타데이터', () => {
  it('읽기 — 모르는 키는 벗기고 필요한 키는 지킨다', () => {
    expect(readCancelRequestMetadata({ ...metadata, junk: 1 })).toEqual(metadata);
    expect(() => readCancelRequestMetadata({ ...metadata, request: { ...metadata.request, kind: 'edit' } })).toThrow();
  });

  it('줄 읽기 — cancel_line 만', () => {
    const line = { type: 'cancel_line', salesOrderLineId: 'l1', channelOrderItemId: 'item_1', quantity: 1 };
    expect(readCancelRequestLines([line])).toEqual([line]);
    expect(() => readCancelRequestLines([{ type: 'quantity_correction' }])).toThrow();
  });

  it('뷰 — 단계·거절·결과', () => {
    const view = toCancelRequestView({
      id: 'r1',
      status: 'rejected',
      createdAt: new Date('2026-10-07T00:00:00.000Z'),
      metadata: {
        ...metadata,
        request: { ...metadata.request, stage: 'edited', convertedFromFull: true },
        rejection: { reasonCode: 'NOT_CANCELABLE', message: '거절', at: '2026-10-07T00:01:00.000Z' },
      },
    });
    expect(view).toEqual({
      id: 'r1',
      status: 'rejected',
      scope: 'partial',
      stage: 'edited',
      convertedFromFull: true,
      requestedAt: '2026-10-07T00:00:00.000Z',
      rejection: { reasonCode: 'NOT_CANCELABLE', message: '거절', at: '2026-10-07T00:01:00.000Z' },
      outcome: null,
      settlement: null,
      refundMode: null,
    });
  });
});

const CONFIRMED = new Date('2026-10-12T01:00:00.000Z');
function row(over: { status?: CancelRequestStatus; settlement?: Record<string, unknown> | null } = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    status: over.status ?? 'settling',
    createdAt: CONFIRMED,
    metadata: {
      salesChannel: 'medusa',
      externalOrderId: 'ext-1',
      request: {
        kind: 'cancel',
        scope: 'full',
        requestedBy: 'customer:c1',
        sourceKey: 'k1',
        appliedAt: CONFIRMED.toISOString(),
        command: { requestId: '11111111-1111-4111-8111-111111111111' },
      },
      ...(over.settlement === null
        ? {}
        : { settlement: over.settlement ?? { state: 'in_progress', mode: 'auto', since: CONFIRMED.toISOString() } }),
    },
  };
}
const minutes = (n: number) => new Date(CONFIRMED.getTime() + n * 60_000);

describe('정산 상태(#1016 36번 재설계 §5.1)', () => {
  it('확정 후 30분까지는 정산 중, 넘으면 지연 — 경계는 «넘어야»', () => {
    expect(settlementPhase({ state: 'in_progress' }, CONFIRMED, minutes(30))).toBe('in_progress');
    expect(settlementPhase({ state: 'in_progress' }, CONFIRMED, new Date(minutes(30).getTime() + 1))).toBe('delayed');
  });

  it('거절은 시간과 무관하게 거절', () => {
    expect(settlementPhase({ state: 'refused' }, CONFIRMED, minutes(1))).toBe('refused');
  });

  it('settling 행의 뷰 — 확정 시각은 행 created_at, 기한은 3영업일', () => {
    expect(toSettlementView(row(), minutes(5))).toEqual({
      requestId: '11111111-1111-4111-8111-111111111111',
      phase: 'in_progress',
      mode: 'auto',
      confirmedAt: '2026-10-12T01:00:00.000Z',
      deadlineAt: '2026-10-15T01:00:00.000Z',
      lastFailure: null,
    });
  });

  it('마지막 실패를 그대로 싣는다', () => {
    const lastFailure = { code: 'wallet_refund_refused:REFUND_NOT_AUTOMATABLE', message: '자동 환불 불가', retryable: false, at: minutes(1).toISOString() };
    const view = toSettlementView(row({ settlement: { state: 'refused', mode: 'auto', since: CONFIRMED.toISOString(), lastFailure } }), minutes(2));
    expect(view).toMatchObject({ phase: 'refused', lastFailure });
  });

  it('settling 이 아니면 정산 뷰가 없다', () => {
    expect(toSettlementView(row({ status: 'applied' }), minutes(5))).toBeNull();
  });

  it('요청 뷰 — settling 을 받는다(전에는 던졌다: GET /sales-orders/:id 가 500)', () => {
    const view = toCancelRequestView(row(), minutes(40));
    expect(view).toMatchObject({ status: 'settling', refundMode: 'auto', settlement: { phase: 'delayed' } });
  });

  it('옛 행(정산 칸 없음)은 settlement·refundMode 가 null', () => {
    expect(toCancelRequestView(row({ status: 'requested', settlement: null }))).toMatchObject({
      status: 'requested',
      settlement: null,
      refundMode: null,
    });
  });

  it('끝난 수동 정산도 refundMode 는 남는다 — admin-web 이 «계좌 송금» 링크를 그린다', () => {
    const view = toCancelRequestView(row({ status: 'applied', settlement: { state: 'in_progress', mode: 'manual', since: CONFIRMED.toISOString() } }));
    expect(view).toMatchObject({ status: 'applied', settlement: null, refundMode: 'manual' });
  });

  it('나쁜 순서: 거절 < 지연 < 정산 중', () => {
    expect(PHASE_RANK.refused).toBeLessThan(PHASE_RANK.delayed);
    expect(PHASE_RANK.delayed).toBeLessThan(PHASE_RANK.in_progress);
  });
});
