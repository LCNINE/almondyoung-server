import {
  toReconcileRun,
  toReconcileRunsOverview,
} from './reservation-reconcile-runs.shape';

const run = {
  id: 'r1',
  startedAt: '2026-11-09T01:00:00.000Z',
  finishedAt: '2026-11-09T01:00:05.000Z',
  status: 'halted',
  candidates: 40,
  plannedFixes: 12,
  fixes: 0,
  fixFailures: 0,
  deferred: 0,
  unknown: 3,
  oldestUnknownAt: '2026-11-05T00:00:00.000Z',
  examples: [{ lineItemId: 'li_1', current: 2, target: 1 }, { bad: true }],
  error: null,
  closedAt: null,
};

describe('toReconcileRunsOverview', () => {
  it('벗겨진 본문과 {data} 본문을 모두 받는다', () => {
    const inner = { open: [run], latest: run };
    expect(toReconcileRunsOverview(inner)?.open).toHaveLength(1);
    const wrapped = toReconcileRunsOverview({ data: inner });
    expect(wrapped?.latest?.id).toBe('r1');
    expect(wrapped?.latest).toMatchObject({ candidates: 40, plannedFixes: 12 });
    expect(wrapped?.open[0].examples).toEqual([
      { lineItemId: 'li_1', current: 2, target: 1 },
    ]);
  });

  it('latest 가 null 이어도 받는다', () => {
    expect(toReconcileRunsOverview({ data: { open: [], latest: null } })).toEqual(
      { open: [], latest: null }
    );
  });

  it.each([
    ['null', null],
    ['문자열', 'x'],
    ['open 없음', { data: { latest: null } }],
    ['open 이 배열 아님', { data: { open: {}, latest: null } }],
    ['행 모양 틀림', { data: { open: [{ id: 1 }], latest: null } }],
    ['모르는 상태', { data: { open: [{ ...run, status: 'zzz' }], latest: null } }],
    ['latest 모양 틀림', { data: { open: [], latest: { id: 1 } } }],
  ])('모양이 틀리면 null: %s', (_n, body) => {
    expect(toReconcileRunsOverview(body)).toBeNull();
  });
});

describe('toReconcileRun', () => {
  it('{data: run} 를 받고 틀리면 null', () => {
    expect(toReconcileRun({ data: run })?.id).toBe('r1');
    expect(toReconcileRun({ data: { nope: 1 } })).toBeNull();
    expect(toReconcileRun(undefined)).toBeNull();
  });
});
