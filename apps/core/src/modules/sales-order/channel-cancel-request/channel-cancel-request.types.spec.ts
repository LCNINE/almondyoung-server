import { readCancelRequestLines, readCancelRequestMetadata, toCancelRequestView } from './channel-cancel-request.types';

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
      refundFailure: null,
      rejection: { reasonCode: 'NOT_CANCELABLE', message: '거절', at: '2026-10-07T00:01:00.000Z' },
      outcome: null,
    });
  });

  it('환불 거절 사유는 읽기·쓰기 왕복에서 살아남는다 — 스키마에 없으면 다음 write 가 조용히 떨군다(#1016 36번)', () => {
    const refundFailure = { kind: 'ledger_mismatch', walletCode: 'REFUND_AMOUNT_EXCEEDS_TOTAL', message: '장부 불일치', at: '2026-10-10T00:00:00.000Z' };
    const withFailure = { ...metadata, request: { ...metadata.request, refundFailure } };
    expect(readCancelRequestMetadata(withFailure)).toEqual(withFailure);
    expect(() =>
      readCancelRequestMetadata({ ...metadata, request: { ...metadata.request, refundFailure: { ...refundFailure, kind: 'other' } } }),
    ).toThrow();
  });

  it('뷰 — 열린 요청의 환불 거절 사유', () => {
    const refundFailure = { kind: 'refused', walletCode: 'REFUND_NOT_AUTOMATABLE', message: '환불 불가', at: '2026-10-10T00:00:00.000Z' };
    const view = toCancelRequestView({
      id: 'r1',
      status: 'requested',
      createdAt: new Date('2026-10-07T00:00:00.000Z'),
      metadata: { ...metadata, request: { ...metadata.request, refundFailure } },
    });
    expect(view.refundFailure).toEqual(refundFailure);
    expect(view.rejection).toBeNull();
  });
});
