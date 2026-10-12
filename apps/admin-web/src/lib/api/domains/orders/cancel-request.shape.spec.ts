import {
  cancelActionOf,
  cancelRequestFromAmendment,
  cancelRequestLine,
  cancelRequestToast,
  MANUAL_REFUND_CONFIRM_TEXT,
  settlementActionsOf,
  settlementReason,
  settlementTiming,
  toSettlementView,
  type SettlementView,
  isCancelRequested,
  toCancelRequestView,
  asksAlreadyRefunded,
  parseAlreadyRefunded,
} from './cancel-request.shape';

const view = (over: Record<string, unknown> = {}) => ({
  id: 'r1',
  status: 'settling',
  scope: 'partial',
  convertedFromFull: false,
  requestedAt: '2026-10-07T00:00:00.000Z',
  rejection: null,
  outcome: null,
  settlement: null,
  refundMode: null,
  ...over,
});

describe('cancel-request shape', () => {
  it('뷰 읽기 — 모양이 깨지면 null', () => {
    expect(toCancelRequestView(view())).toEqual(view());
    expect(toCancelRequestView({ id: 'r1' })).toBeNull();
    expect(toCancelRequestView(null)).toBeNull();
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
    [view({ status: 'applied', outcome: { refundAmount: 27500, shippingCharge: 3000, shippingRefund: 0, shippingNotAdjusted: false } }), '부분취소 반영 · 환불 27,500원 · 배송비 −3,000원'],
    [view({ status: 'applied', outcome: { refundAmount: 9000, shippingCharge: 0, shippingRefund: 3000, shippingNotAdjusted: false } }), '부분취소 반영 · 환불 9,000원 · 배송비 환불 3,000원'],
    [view({ status: 'applied', outcome: { refundAmount: 9000, shippingCharge: 0, shippingRefund: 0, shippingNotAdjusted: true } }), '부분취소 반영 · 환불 9,000원 · 배송비 미조정'],
    [view({ scope: 'full', status: 'applied' }), '전체취소 반영'],
    [view({ convertedFromFull: true }), '부분취소(출고분 제외) 확정 · 정산 중'],
    [view({ status: 'rejected', rejection: { reasonCode: 'OPERATOR_WITHDRAWN', message: 'm', at: 'x' } }), '부분취소 실패 · 요청 접음 · m'],
    [view({ status: 'superseded' }), '부분취소 요청 · 다른 변경으로 대체됨'],
  ])('변경 기록 한 줄 %#', (v, line) => {
    expect(cancelRequestLine(v as never)).toBe(line);
  });

  it('응답 가르기', () => {
    expect(isCancelRequested({ requestId: 'r1', status: 'settling', scope: 'full', convertedFromFull: false })).toBe(true);
    expect(isCancelRequested({ status: 'cancelled', refundStatus: 'succeeded' })).toBe(false);
  });
});

describe('정산(#1016 36번 재설계)', () => {
  const settlement = (over: Partial<SettlementView> = {}): SettlementView => ({
    requestId: 'r1',
    phase: 'refused',
    mode: 'auto',
    confirmedAt: '2026-10-12T01:00:00.000Z',
    deadlineAt: '2026-10-15T01:00:00.000Z',
    lastFailure: { code: 'wallet_refund_refused:REFUND_NOT_AUTOMATABLE', message: '자동 환불할 수 없는 결제수단입니다', retryable: false, at: '2026-10-12T01:00:05.000Z' },
    ...over,
  });

  it('응답의 settling·정산 칸을 읽는다 — 옛 core 응답(칸 없음)은 null', () => {
    const v = toCancelRequestView({ id: 'r1', status: 'settling', scope: 'full', requestedAt: 'x', settlement: settlement(), refundMode: 'auto' });
    expect(v).toMatchObject({ status: 'settling', refundMode: 'auto', settlement: { phase: 'refused' } });
    expect(toCancelRequestView({ id: 'r1', status: 'settling', scope: 'full' })).toMatchObject({ settlement: null, refundMode: null });
  });

  it('모양이 틀린 정산 칸은 null', () => {
    expect(toSettlementView({ requestId: 'r1', phase: 'weird' })).toBeNull();
    expect(toSettlementView(null)).toBeNull();
  });

  it.each([
    ['in_progress', '환불 처리 중', false],
    ['delayed', '환불 지연', true],
    ['refused', '환불 거절', true],
  ] as const)('취소 칸 — %s → %s', (phase, label, alert) => {
    const request = toCancelRequestView({ id: 'r1', status: 'settling', scope: 'full', settlement: settlement({ phase }) });
    expect(cancelActionOf({ channel: 'medusa', orderStatus: 'cancelled', cancelRequest: request })).toEqual({ kind: 'settling', label, alert });
  });

  it('사유 — wallet·PG 거절은 «환불 거절», 그 밖은 «정산 실패 · 개발 확인»(PR 3 넘길 것 4)', () => {
    expect(settlementReason(settlement())).toBe('환불 거절 · 자동 환불할 수 없는 결제수단입니다');
    expect(settlementReason(settlement({ lastFailure: { code: 'not_found', message: 'Order not found', retryable: false, at: 'x' } }))).toBe(
      '정산 실패 · 개발 확인 · Order not found',
    );
    expect(settlementReason(settlement({ lastFailure: { code: 'http_502', message: '', retryable: true, at: 'x' } }))).toBe('정산 실패 · 개발 확인 · http_502');
    expect(settlementReason(settlement({ lastFailure: null }))).toBeNull();
    expect(settlementReason(settlement({ phase: 'in_progress' }))).toBeNull();
  });

  it('37번 — 채널이 «이미 환불한 금액»을 물은 정산(external_refund_*)이면 사유를 그 말로 보이고, 다시 시도에서 금액을 묻는다', () => {
    const asked = (code: string, over: Partial<SettlementView> = {}) =>
      settlement({ lastFailure: { code, message: '품목에 연결 안 된 외부 환불 3,000원이 있습니다', retryable: false, at: 'x' }, ...over });
    expect(settlementReason(asked('external_refund_unresolved'))).toBe('이미 환불한 금액 확인 필요 · 품목에 연결 안 된 외부 환불 3,000원이 있습니다');
    expect(asksAlreadyRefunded(asked('external_refund_unresolved'))).toBe(true);
    expect(asksAlreadyRefunded(asked('external_refund_exceeds'))).toBe(true);
    expect(asksAlreadyRefunded(asked('external_refund_unresolved', { phase: 'in_progress' }))).toBe(false);
    expect(asksAlreadyRefunded(settlement())).toBe(false);
    expect(asksAlreadyRefunded(null)).toBe(false);
  });

  it('37번 — 이미 환불한 금액 입력은 0 이상의 정수만(콤마 허용)', () => {
    expect(parseAlreadyRefunded('3000')).toBe(3000);
    expect(parseAlreadyRefunded(' 3,000 ')).toBe(3000);
    expect(parseAlreadyRefunded('0')).toBe(0);
    expect(parseAlreadyRefunded('')).toBeNull();
    expect(parseAlreadyRefunded('-1')).toBeNull();
    expect(parseAlreadyRefunded('12.5')).toBeNull();
    expect(parseAlreadyRefunded('abc')).toBeNull();
  });

  it('조치 — 정산 중엔 없음, 지연·거절엔 둘, 이미 계좌 송금이면 다시 시도만', () => {
    expect(settlementActionsOf(settlement({ phase: 'in_progress' }))).toEqual({ retry: false, manualRefund: false });
    expect(settlementActionsOf(settlement({ phase: 'delayed' }))).toEqual({ retry: true, manualRefund: true });
    expect(settlementActionsOf(settlement({ mode: 'manual' }))).toEqual({ retry: true, manualRefund: false });
    expect(settlementActionsOf(null)).toEqual({ retry: false, manualRefund: false });
  });

  it('경과·기한 — 기한은 한국 날짜', () => {
    // 확정 01:00Z, 지금 02:30Z → 1시간 30분. 기한 2026-10-15T01:00Z = 10/15(목) KST
    expect(settlementTiming(settlement(), Date.parse('2026-10-12T02:30:00.000Z'))).toBe('확정 후 1시간 30분 · 기한 10/15(목)');
  });

  it('줄 문구 — 확정 + 정산 상태', () => {
    const v = toCancelRequestView({ id: 'r1', status: 'settling', scope: 'full', settlement: settlement({ phase: 'delayed' }) })!;
    expect(cancelRequestLine(v)).toBe('전체취소 확정 · 환불 지연');
  });

  it('운영자 취소 응답은 늘 확정 — 상태와 무관하게 «취소했습니다»(PR 6)', () => {
    expect(cancelRequestToast({ requestId: 'r', status: 'settling', scope: 'full', convertedFromFull: false })).toBe('취소했습니다. 환불은 채널이 처리합니다.');
    expect(cancelRequestToast({ requestId: 'r', status: 'applied', scope: 'partial', convertedFromFull: true })).toBe(
      '출고된 상품을 뺀 나머지를 취소했습니다. 환불은 채널이 처리합니다.',
    );
  });

  it('옛 requested 응답은 뷰가 되지 않는다 — 버튼 없이 «취소»로 다시 요청할 수 있다', () => {
    expect(toCancelRequestView({ id: 'r', status: 'requested', scope: 'full' })).toBeNull();
    expect(cancelActionOf({ channel: 'medusa', orderStatus: 'confirmed', cancelRequest: null })).toEqual({ kind: 'cancel', label: '취소' });
  });

  it('계좌 송금 확인 문구는 실제 화면 이름을 쓴다(D7, PR 6 — 환불 내역에 [완료 처리]가 생겼다)', () => {
    expect(MANUAL_REFUND_CONFIRM_TEXT).toBe('고객에게 계좌를 받아 직접 송금한 뒤, 결제 관리 › 환불 내역에서 [완료 처리]를 눌러 주세요.');
  });
});
