import { diffLabelItems, labelStateOf, latestPrint, revisionFor } from './label-print-policy';

const item = (locationCode: string, skuId: string, quantity: number, name = skuId) => ({
  locationCode,
  skuId,
  name,
  quantity,
});
const print = (fingerprint: string, revision: number, printedAt: string, itemsSnapshot = [item('A', 's1', 1)]) => ({
  fingerprint,
  revision,
  itemsSnapshot,
  printedAt: new Date(printedAt),
});

describe('revisionFor', () => {
  it('첫 판은 1', () => expect(revisionFor([], 'f1')).toBe(1));
  it('같은 지문이 출력된 적 있으면 그 판차', () => {
    expect(revisionFor([print('f1', 1, '2026-09-30T00:00:00Z'), print('f2', 2, '2026-09-30T01:00:00Z')], 'f1')).toBe(1);
  });
  it('새 지문이면 최대 판차 + 1', () => {
    expect(revisionFor([print('f1', 1, '2026-09-30T00:00:00Z'), print('f2', 2, '2026-09-30T01:00:00Z')], 'f3')).toBe(3);
  });
});

describe('latestPrint', () => {
  it('없으면 null', () => expect(latestPrint([])).toBeNull());
  it('printed_at 이 가장 늦은 기록 — 판차가 아니다(A→B→A 로 A 를 다시 출력한 박스)', () => {
    const a = print('fa', 1, '2026-09-30T03:00:00Z');
    const b = print('fb', 2, '2026-09-30T02:00:00Z');
    expect(latestPrint([b, a])?.fingerprint).toBe('fa');
  });
});

describe('diffLabelItems', () => {
  it('(로케이션, SKU) 로 맞춰 수량이 다른 줄만, 로케이션 코드 순', () => {
    expect(diffLabelItems([item('A', 's1', 2), item('B', 's2', 1)], [item('A', 's1', 2), item('C', 's2', 1)])).toEqual([
      { locationCode: 'B', skuId: 's2', name: 's2', printedQty: 1, currentQty: 0 },
      { locationCode: 'C', skuId: 's2', name: 's2', printedQty: 0, currentQty: 1 },
    ]);
  });
});

describe('labelStateOf', () => {
  const printable = { kind: 'printable' as const, fingerprint: 'f2', items: [item('A', 's1', 3)] };
  it.each([
    ['시작 전 배치', { batchStarted: false, current: printable, prints: [] }, 'not_started'],
    ['앱이 못 그리는 송장', { batchStarted: true, current: { kind: 'external' as const }, prints: [] }, 'external'],
    [
      '조립 실패',
      { batchStarted: true, current: { kind: 'unavailable' as const, issue: 'WAYBILL_STALE' }, prints: [] },
      'unavailable',
    ],
    ['출력 기록 없음', { batchStarted: true, current: printable, prints: [] }, 'never_printed'],
    [
      '마지막 출력 = 현재',
      { batchStarted: true, current: printable, prints: [print('f2', 1, '2026-09-30T00:00:00Z')] },
      'current',
    ],
    [
      '지문이 바뀜',
      { batchStarted: true, current: printable, prints: [print('f1', 1, '2026-09-30T00:00:00Z')] },
      'reprint_required',
    ],
  ])('%s → %s', (_label, input, state) => {
    expect(labelStateOf(input).state).toBe(state);
  });

  it('reprint_required 는 마지막 출력 스냅샷과 현재 줄의 차이를 싣는다', () => {
    const view = labelStateOf({
      batchStarted: true,
      current: printable,
      prints: [print('f1', 1, '2026-09-30T00:00:00Z', [item('A', 's1', 1)])],
    });
    expect(view.changes).toEqual([{ locationCode: 'A', skuId: 's1', name: 's1', printedQty: 1, currentQty: 3 }]);
  });

  it('unavailable 은 사유 코드를 issue 로 싣는다', () => {
    expect(
      labelStateOf({ batchStarted: true, current: { kind: 'unavailable', issue: 'WAYBILL_STALE' }, prints: [] }).issue,
    ).toBe('WAYBILL_STALE');
  });
});
