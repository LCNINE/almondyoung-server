import { describe, expect, it } from 'vitest';
import { labelGateOf } from './labelGate';

const found = (labelState: string | null, over = {}) =>
  ({ labelState, labelChanges: [], labelIssue: null, ...over }) as Parameters<typeof labelGateOf>[0];
const change = { locationCode: 'A-01', skuId: 's', name: '볼펜', printedQty: 1, currentQty: 2 };

describe('labelGateOf', () => {
  it.each([
    ['current', true, { kind: 'open' }],
    ['external', false, { kind: 'open' }],
    [null, false, { kind: 'open' }],
    ['never_printed', true, { kind: 'print', message: '송장을 아직 출력하지 않았어요. 출력한 뒤 송장을 다시 스캔해 주세요.', changes: [] }],
    ['never_printed', false, { kind: 'blocked', message: '송장을 아직 출력하지 않았어요. 프린터 있는 자리에서 출력해 주세요.' }],
    ['reprint_required', false, { kind: 'blocked', message: '송장이 바뀌었어요. 프린터 있는 자리에서 새 송장을 출력해 주세요.' }],
    ['not_started', true, { kind: 'blocked', message: '배치 화면에서 「작업 시작」을 먼저 눌러 주세요.' }],
    ['unavailable', true, { kind: 'blocked', message: '송장 상태를 확인할 수 없어요. 관리자에게 문의해 주세요.' }],
  ])('%s (프린터 %s) → %o', (state, canPrint, expected) => {
    expect(labelGateOf(found(state), canPrint)).toEqual(expected);
  });

  it('reprint_required 는 바뀐 줄을 싣고 옛 송장을 버리라고 한다', () => {
    expect(labelGateOf(found('reprint_required', { labelChanges: [change] }), true)).toEqual({
      kind: 'print',
      message: '송장이 바뀌었어요. 새 송장을 출력하고 옛 송장은 버려 주세요.',
      changes: [change],
    });
  });

  it('unavailable 이 WAYBILL_STALE 이면 재발급 안내', () => {
    expect(labelGateOf(found('unavailable', { labelIssue: 'WAYBILL_STALE' }), true)).toEqual({
      kind: 'blocked',
      message: '주문(주소·상품)이 바뀌어 이 송장은 쓸 수 없어요. 관리자에게 재발급을 요청해 주세요.',
    });
  });
});
