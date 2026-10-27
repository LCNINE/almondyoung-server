import type { OrderReturnable, ReturnRejectReason } from '@/lib/types/dto/customer-returns';
import {
  buildReturnRequestBody,
  isCustomerReturnReason,
  isReturnRejectReason,
  returnRejectMessage,
  RETURN_REJECT_MESSAGES,
  windowOverrideNeeded,
  type ReturnRequestForm,
} from './return-request-form';

const NOW = new Date('2026-10-28T00:00:00.000Z');
const OPEN = '2026-11-10T00:00:00.000Z';
const CLOSED = '2026-10-01T00:00:00.000Z';

const returnable: OrderReturnable = {
  items: [
    { item_id: 'a', returnable_quantity: 2, window_ends_at: OPEN },
    { item_id: 'b', returnable_quantity: 3, window_ends_at: CLOSED },
  ],
};

const form = (p: Partial<ReturnRequestForm> = {}): ReturnRequestForm => ({
  quantities: { a: 1 },
  reason: 'change_of_mind',
  note: '',
  feeBearer: null,
  windowOverrideReason: '',
  ...p,
});

const build = (f: ReturnRequestForm) => buildReturnRequestBody(f, returnable, 'req-1', NOW);

describe('buildReturnRequestBody', () => {
  it('정상 입력은 본문을 만든다 (수량 0 줄은 뺀다, 메모 공백은 싣지 않는다)', () => {
    const r = build(form({ quantities: { a: 2, b: 0 }, note: '   ' }));
    expect(r).toEqual({
      ok: true,
      body: { request_id: 'req-1', items: [{ item_id: 'a', quantity: 2 }], reason: 'change_of_mind' },
    });
  });

  it('메모는 다듬어 싣는다', () => {
    const r = build(form({ note: ' 파손 ' }));
    expect(r.ok && r.body.note).toBe('파손');
  });

  it('수량이 전부 0 이면 오류', () => {
    expect(build(form({ quantities: { a: 0, b: 0 } })).ok).toBe(false);
  });

  it('반품 가능 수량 초과면 오류', () => {
    expect(build(form({ quantities: { a: 3 } })).ok).toBe(false);
  });

  it('소수·음수 수량은 오류', () => {
    expect(build(form({ quantities: { a: 1.5 } })).ok).toBe(false);
    expect(build(form({ quantities: { a: -1 } })).ok).toBe(false);
  });

  it('반품 가능 목록에 없는 줄은 오류', () => {
    expect(build(form({ quantities: { zzz: 1 } })).ok).toBe(false);
  });

  it('사유가 없으면 오류', () => {
    expect(build(form({ reason: '' })).ok).toBe(false);
  });

  it('other 인데 부담 주체가 없으면 오류, 있으면 싣는다', () => {
    expect(build(form({ reason: 'other' })).ok).toBe(false);
    const r = build(form({ reason: 'other', feeBearer: 'seller' }));
    expect(r.ok && r.body.fee_bearer).toBe('seller');
  });

  it('other 가 아니면 fee_bearer 를 싣지 않는다', () => {
    const r = build(form({ feeBearer: 'seller' }));
    expect(r.ok && 'fee_bearer' in r.body).toBe(false);
  });

  it('기한 넘긴 줄을 골랐는데 사유가 공백이면 오류, 있으면 싣는다', () => {
    expect(build(form({ quantities: { b: 1 }, windowOverrideReason: '  ' })).ok).toBe(false);
    const r = build(form({ quantities: { b: 1 }, windowOverrideReason: ' 고객 항의 ' }));
    expect(r.ok && r.body.window_override_reason).toBe('고객 항의');
  });

  it('기한 안의 줄만 고르면 window_override_reason 을 싣지 않는다', () => {
    const r = build(form({ windowOverrideReason: '남은 글' }));
    expect(r.ok && 'window_override_reason' in r.body).toBe(false);
  });
});

describe('windowOverrideNeeded', () => {
  it('기한 넘긴 줄을 수량 > 0 으로 골랐을 때만 true', () => {
    expect(windowOverrideNeeded(form({ quantities: { b: 1 } }), returnable, NOW)).toBe(true);
    expect(windowOverrideNeeded(form({ quantities: { a: 1, b: 0 } }), returnable, NOW)).toBe(false);
    expect(windowOverrideNeeded(form({ quantities: { a: 1 } }), returnable, NOW)).toBe(false);
  });
  it('window_ends_at 이 null 이면 기한 없음', () => {
    const r: OrderReturnable = { items: [{ item_id: 'n', returnable_quantity: 1, window_ends_at: null }] };
    expect(windowOverrideNeeded(form({ quantities: { n: 1 } }), r, NOW)).toBe(false);
  });
});

describe('guards', () => {
  it('접수 사유는 여섯 값만 통과한다', () => {
    expect(isCustomerReturnReason('defective')).toBe(true);
    expect(isCustomerReturnReason('brand_new')).toBe(false);
    expect(isCustomerReturnReason('')).toBe(false);
  });

  it('거절 사유는 맵의 키만 통과한다 (prototype 키 제외)', () => {
    expect(isReturnRejectReason('not_delivered')).toBe(true);
    expect(isReturnRejectReason('toString')).toBe(false);
    expect(isReturnRejectReason(undefined)).toBe(false);
  });

  it('목록에 없는 사유는 폼 오류다', () => {
    expect(build(form({ reason: 'brand_new' }))).toEqual({ ok: false, error: '반품 사유를 고르세요' });
  });
});

describe('returnRejectMessage', () => {
  const ALL: ReturnRejectReason[] = [
    'order_canceled', 'item_not_in_order', 'not_delivered', 'quantity_exceeds_returnable', 'window_closed',
    'window_override_reason_required', 'reason_not_found', 'reason_not_selectable', 'fee_bearer_required',
    'request_id_conflict', 'return_option_missing', 'return_already_received', 'not_our_return',
    'return_arrived', 'return_prepaid',
  ];

  it('맵의 키 집합은 15종 전체다', () => {
    expect(Object.keys(RETURN_REJECT_MESSAGES).sort()).toEqual([...ALL].sort());
    expect(ALL).toHaveLength(15);
  });

  it('400 return_rejected 는 reason 을 한국어로 옮긴다', () => {
    const err = { response: { status: 400, data: { type: 'not_allowed', code: 'return_rejected', reason: 'not_delivered', message: 'x' } } };
    expect(returnRejectMessage(err)).toBe(RETURN_REJECT_MESSAGES.not_delivered);
  });

  it('모르는 reason 은 서버 문구로 떨어진다', () => {
    const err = { response: { status: 400, data: { code: 'return_rejected', reason: 'brand_new', message: '서버 문구' } } };
    expect(returnRejectMessage(err)).toBe('서버 문구');
  });

  it('request_id_conflict 는 다시 접수하라고 안내하지 않는다', () => {
    const err = { response: { status: 400, data: { code: 'return_rejected', reason: 'request_id_conflict' } } };
    const msg = returnRejectMessage(err);
    expect(msg).toBe('이 접수는 이미 처리됐습니다 — 다시 접수하지 말고 반품 목록(5분 안에 나타납니다)을 확인하세요');
  });

  it('502 core_unavailable', () => {
    const err = { response: { status: 502, data: { type: 'core_unavailable' } } };
    expect(returnRejectMessage(err)).toBe('주문 확인이 잠시 안 됩니다. 잠시 뒤 다시 시도하세요');
  });

  it('그 밖은 parseServerError 문구', () => {
    expect(returnRejectMessage({ response: { status: 500, data: { message: '터짐' } } })).toBe('터짐');
  });
});
