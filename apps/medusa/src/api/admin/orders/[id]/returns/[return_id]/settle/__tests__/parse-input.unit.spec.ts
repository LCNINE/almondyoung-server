import { MedusaError } from '@medusajs/framework/utils';

import { parseInput } from '../parse-input';

describe('return settle parseInput', () => {
  const base = { requestId: 'r1', items: [{ item_id: 'i1', received: 1, dismissed: 0 }] };

  it('item_id/received/dismissed 를 itemId/received/dismissed 로, refundMode 가 없으면 칸이 없다', () => {
    expect(parseInput(base)).toEqual({ requestId: 'r1', items: [{ itemId: 'i1', received: 1, dismissed: 0 }] });
  });
  it.each(['auto', 'manual'])('refundMode %s 는 그대로', (mode) => {
    expect(parseInput({ ...base, refundMode: mode }).refundMode).toBe(mode);
  });
  it('PR 6b 칸 — hold_deduction·already_refunded_amount·closes_missing 을 camelCase 로', () => {
    expect(
      parseInput({ ...base, hold_deduction: { amount: 5000, memo: '사용 흔적' }, already_refunded_amount: 0, closes_missing: true }),
    ).toEqual({
      requestId: 'r1',
      items: [{ itemId: 'i1', received: 1, dismissed: 0 }],
      holdDeduction: { amount: 5000, memo: '사용 흔적' },
      alreadyRefundedAmount: 0,
      closesMissing: true,
    });
  });
  it.each([
    ['holdDeduction', { amount: 5000, memo: 'm' }, 'hold_deduction'],
    ['alreadyRefundedAmount', 10000, 'already_refunded_amount'],
    ['closesMissing', true, 'closes_missing'],
  ])('camelCase %s 는 snake_case 키를 짚어 INVALID_DATA — 버리면 차감·상계 없이 정산돼 더 환불한다', (key, value, snake) => {
    let err: unknown;
    try {
      parseInput({ ...base, [key]: value });
    } catch (e) {
      err = e;
    }
    expect(MedusaError.isMedusaError(err) && err.type === MedusaError.Types.INVALID_DATA).toBe(true);
    expect((err as Error).message).toContain(snake);
  });
  it('closes_missing false 는 칸이 없는 것과 같다', () => {
    expect(parseInput({ ...base, closes_missing: false })).not.toHaveProperty('closesMissing');
  });
  it.each([
    [{}],
    [{ requestId: ' ', items: base.items }],
    [{ requestId: 'r', items: [] }],
    [{ requestId: 'r', items: [{ item_id: 'i', received: 1 }] }],
    [{ requestId: 'r', items: [{ item_id: 'i', received: -1, dismissed: 1 }] }],
    [{ requestId: 'r', items: [{ item_id: 'i', received: 0.5, dismissed: 0 }] }],
    [{ requestId: 'r', items: [{ item_id: '', received: 1, dismissed: 0 }] }],
    [{ ...base, refundMode: 'MANUAL' }],
    [{ ...base, hold_deduction: { amount: 0, memo: 'm' } }],
    [{ ...base, hold_deduction: { amount: 1.5, memo: 'm' } }],
    [{ ...base, hold_deduction: { amount: 1000, memo: '  ' } }],
    [{ ...base, hold_deduction: { amount: 1000, memo: 'x'.repeat(501) } }],
    [{ ...base, hold_deduction: { amount: 1000 } }],
    [{ ...base, already_refunded_amount: -1 }],
    [{ ...base, already_refunded_amount: '10000' }],
    [{ ...base, closes_missing: 'true' }],
  ])('INVALID_DATA: %j', (body) => {
    try {
      parseInput(body);
      throw new Error('던지지 않았다');
    } catch (e) {
      expect(MedusaError.isMedusaError(e) && e.type === MedusaError.Types.INVALID_DATA).toBe(true);
    }
  });
});
