import {
  cancelActionOf,
  cancelRequestFromAmendment,
  cancelRequestLine,
  hasFreshOpenCancelRequest,
  settledCancelRequestIds,
  isCancelRequested,
  toCancelRequestView,
  unresolvedRefundToAsk,
} from './cancel-request.shape';

const view = (over: Record<string, unknown> = {}) => ({
  id: 'r1',
  status: 'requested',
  scope: 'partial',
  stage: null,
  convertedFromFull: false,
  requestedAt: '2026-10-07T00:00:00.000Z',
  rejection: null,
  outcome: null,
  ...over,
});

describe('cancel-request shape', () => {
  it('뷰 읽기 — 모양이 깨지면 null', () => {
    expect(toCancelRequestView(view())).toEqual(view());
    expect(toCancelRequestView({ id: 'r1' })).toBeNull();
    expect(toCancelRequestView(null)).toBeNull();
  });

  it('37번 — 외부 환불 미해결 거절 뒤에만 «이미 환불한 금액»을 묻는다', () => {
    const rejected = (reasonCode: string, extra: Record<string, unknown> = {}) =>
      toCancelRequestView(view({ status: 'rejected', rejection: { reasonCode, message: 'm', at: 't', ...extra } }));
    expect(unresolvedRefundToAsk(rejected('EXTERNAL_REFUND_UNRESOLVED', { unresolvedRefundAmount: 10000 }))).toBe(10000);
    expect(unresolvedRefundToAsk(rejected('EXTERNAL_REFUND_UNRESOLVED'))).toBe(0);
    expect(unresolvedRefundToAsk(rejected('NOT_CANCELABLE'))).toBeNull();
    expect(unresolvedRefundToAsk(toCancelRequestView(view()))).toBeNull();
    expect(unresolvedRefundToAsk(null)).toBeNull();
  });

  it('37번 — 반영 줄에 상계를 적고, 거절 줄은 라벨로 보인다', () => {
    const applied = toCancelRequestView(
      view({ status: 'applied', outcome: { refundAmount: 20000, shippingCharge: 0, shippingRefund: 0, shippingNotAdjusted: false, externalRefundApplied: 10000 } }),
    )!;
    expect(cancelRequestLine(applied)).toBe('부분취소 반영 · 환불 20,000원 · 외부 환불 10,000원 상계');
    const rejected = toCancelRequestView(
      view({ status: 'rejected', rejection: { reasonCode: 'EXTERNAL_REFUND_UNRESOLVED', message: '외부 환불 10,000원', at: 't' } }),
    )!;
    expect(cancelRequestLine(rejected)).toBe('부분취소 실패 · 이미 환불한 금액 확인 필요 · 외부 환불 10,000원');
  });

  it('변경 기록 행 — 취소 요청 행만, 메타데이터에서 같은 뷰를 만든다', () => {
    const row = {
      id: 'r1',
      salesOrderId: 's1',
      origin: 'operator',
      status: 'rejected',
      deltas: [],
      occurredAt: '2026-10-07T00:00:00.000Z',
      reasonCode: 'CHANNEL_CANCEL_REQUEST',
      metadata: {
        request: { kind: 'cancel', scope: 'full', convertedFromFull: false },
        rejection: { reasonCode: 'NOT_CANCELABLE', message: '거절', at: '2026-10-07T00:01:00.000Z' },
      },
    };
    expect(cancelRequestFromAmendment(row)).toMatchObject({
      id: 'r1',
      status: 'rejected',
      scope: 'full',
      rejection: { reasonCode: 'NOT_CANCELABLE' },
    });
    expect(cancelRequestFromAmendment({ ...row, reasonCode: 'CHANNEL_ORDER_MODIFIED' })).toBeNull();
  });

  it.each([
    [{ channel: 'naver', orderStatus: 'confirmed', cancelRequest: null }, { kind: 'seller_center', label: '네이버 판매자센터에서 취소' }],
    [{ channel: 'coupang', orderStatus: 'confirmed', cancelRequest: null }, { kind: 'seller_center', label: '쿠팡 판매자센터에서 취소' }],
    [{ channel: 'medusa', orderStatus: 'confirmed', cancelRequest: view() }, { kind: 'requested', label: '취소 요청됨' }],
    [{ channel: 'medusa', orderStatus: 'confirmed', cancelRequest: view({ stage: 'edited' }) }, { kind: 'requested', label: '수정됨 · 환불 미완' }],
    [
      { channel: 'medusa', orderStatus: 'confirmed', cancelRequest: view({ status: 'rejected', rejection: { reasonCode: 'NOT_CANCELABLE', message: '이미 출고', at: 'x' } }) },
      { kind: 'rejected', reason: '채널이 거절 · 이미 출고' },
    ],
    [{ channel: 'medusa', orderStatus: 'processing', cancelRequest: view({ status: 'applied' }) }, { kind: 'cancel', label: '강제취소' }],
    [{ channel: '3pl', orderStatus: 'confirmed', cancelRequest: null }, { kind: 'cancel', label: '취소' }],
  ])('행 → 취소 칸 %#', (row, expected) => {
    expect(cancelActionOf(row as never)).toEqual(expected);
  });

  it.each([
    [view(), '부분취소 요청 · 처리 중'],
    [view({ stage: 'edited' }), '부분취소 요청 · 수정됨 · 환불 미완'],
    [view({ status: 'applied', outcome: { refundAmount: 27500, shippingCharge: 3000, shippingRefund: 0, shippingNotAdjusted: false } }), '부분취소 반영 · 환불 27,500원 · 배송비 −3,000원'],
    [view({ status: 'applied', outcome: { refundAmount: 9000, shippingCharge: 0, shippingRefund: 3000, shippingNotAdjusted: false } }), '부분취소 반영 · 환불 9,000원 · 배송비 환불 3,000원'],
    [view({ status: 'applied', outcome: { refundAmount: 9000, shippingCharge: 0, shippingRefund: 0, shippingNotAdjusted: true } }), '부분취소 반영 · 환불 9,000원 · 배송비 미조정'],
    [view({ scope: 'full', status: 'applied' }), '전체취소 반영'],
    [view({ convertedFromFull: true }), '부분취소(출고분 제외) 요청 · 처리 중'],
    [view({ status: 'rejected', rejection: { reasonCode: 'OPERATOR_WITHDRAWN', message: 'm', at: 'x' } }), '부분취소 실패 · 요청 접음 · m'],
    [view({ status: 'superseded' }), '부분취소 요청 · 다른 변경으로 대체됨'],
  ])('변경 기록 한 줄 %#', (v, line) => {
    expect(cancelRequestLine(v as never)).toBe(line);
  });

  it('응답 가르기·열린 요청 감지', () => {
    expect(isCancelRequested({ requestId: 'r1', status: 'requested', scope: 'full', convertedFromFull: false })).toBe(true);
    expect(isCancelRequested({ status: 'cancelled', refundStatus: 'succeeded' })).toBe(false);
  });

  it('방금 낸 열린 요청만 폴링 대상 — 2분을 넘기면 정체 보드의 몫', () => {
    const at = Date.parse('2026-10-07T00:00:00.000Z');
    expect(hasFreshOpenCancelRequest([null, { cancelRequest: view() }], at + 60_000)).toBe(true);
    expect(hasFreshOpenCancelRequest([{ cancelRequest: view() }], at + 120_001)).toBe(false);
    expect(hasFreshOpenCancelRequest([{ cancelRequest: view({ status: 'applied' }) }, { cancelRequest: null }], at)).toBe(false);
    expect(hasFreshOpenCancelRequest([{ cancelRequest: view({ requestedAt: '' }) }], at)).toBe(false);
  });

  it('requested 였다가 requested 가 아니게 된 요청 id 만 «끝남»', () => {
    const open = [{ cancelRequest: view() }, { cancelRequest: view({ id: 'r2' }) }];
    expect(settledCancelRequestIds(open, [{ cancelRequest: view({ status: 'applied' }) }, { cancelRequest: view({ id: 'r2' }) }])).toEqual(['r1']);
    expect(settledCancelRequestIds(open, open)).toEqual([]);
    expect(settledCancelRequestIds([{ cancelRequest: view({ status: 'applied' }) }], [{ cancelRequest: view({ status: 'applied' }) }])).toEqual([]);
    expect(settledCancelRequestIds([], open)).toEqual([]);
    // 요청이 응답에서 사라져도(null) 끝난 것이다
    expect(settledCancelRequestIds(open.slice(0, 1), [{ cancelRequest: null }])).toEqual(['r1']);
  });
});
