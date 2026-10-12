import { ORDER_PROGRESS_STAGES } from './order-progress.thresholds';
import { assembleSummary, groupGaveUpMarks } from './order-progress.summary';

describe('assembleSummary', () => {
  it('0건 단계도 빠짐없이, 단계 순서대로 낸다', () => {
    const out = assembleSummary([], null);
    expect(out.evaluatedAt).toBeNull();
    expect(out.stages.map((s) => s.stage)).toEqual([...ORDER_PROGRESS_STAGES]);
    expect(out.stages.every((s) => s.open === 0 && s.stuck === 0 && s.gaveUp === 0 && s.oldestEnteredAt === null)).toBe(
      true,
    );
  });

  it('세부 상태를 단계로 합치고 최장(가장 이른) 진입 시각을 고른다', () => {
    const out = assembleSummary(
      [
        { stage: 'fo', state: 'awaiting_matching', open: 10, stuck: 9, gaveUp: 2, oldest: '2026-07-16T00:00:00.000Z' },
        { stage: 'fo', state: 'failed', open: 2, stuck: 2, gaveUp: 0, oldest: '2026-09-01T00:00:00.000Z' },
      ],
      '2026-10-06T00:00:00.000Z',
    );
    const fo = out.stages.find((s) => s.stage === 'fo')!;
    expect(fo).toEqual({
      stage: 'fo',
      open: 12,
      stuck: 11,
      gaveUp: 2,
      oldestEnteredAt: '2026-07-16T00:00:00.000Z',
      states: [
        { state: 'awaiting_matching', open: 10, stuck: 9, gaveUp: 2 },
        { state: 'failed', open: 2, stuck: 2, gaveUp: 0 },
      ],
    });
    expect(out.evaluatedAt).toBe('2026-10-06T00:00:00.000Z');
  });

  it('세부 상태는 건수 내림차순', () => {
    const out = assembleSummary(
      [
        { stage: 'pick', state: 'queued', open: 1, stuck: 0, gaveUp: 0, oldest: null },
        { stage: 'pick', state: 'awaiting_batch', open: 5, stuck: 0, gaveUp: 0, oldest: null },
      ],
      null,
    );
    expect(out.stages.find((s) => s.stage === 'pick')!.states.map((s) => s.state)).toEqual([
      'awaiting_batch',
      'queued',
    ]);
  });

  it('알 수 없는 단계 행은 unclassified 로 모은다', () => {
    const out = assembleSummary([{ stage: 'mystery', state: 'x', open: 1, stuck: 1, gaveUp: 0, oldest: null }], null);
    expect(out.stages.find((s) => s.stage === 'unclassified')!.open).toBe(1);
  });
});

describe('groupGaveUpMarks', () => {
  const at = (iso: string) => new Date(iso);
  it('주문마다 규칙 하나에 배지 하나 — 한 주문의 여러 상자가 같은 규칙에서 포기하면 가장 이른 것만, 행 번호 순', () => {
    const got = groupGaveUpMarks([
      {
        salesOrderId: 'o1',
        rule: 'resume-pending-consolidation',
        row: 25,
        since: at('2099-01-02T00:00:00.000Z'),
        lastError: 'b',
      },
      {
        salesOrderId: 'o1',
        rule: 'resume-pending-consolidation',
        row: 25,
        since: at('2099-01-01T00:00:00.000Z'),
        lastError: 'a',
      },
      {
        salesOrderId: 'o1',
        rule: 'wake-awaiting-matching',
        row: 12,
        since: at('2099-01-03T00:00:00.000Z'),
        lastError: null,
      },
      {
        salesOrderId: 'o2',
        rule: 'resume-pending-consolidation',
        row: 25,
        since: at('2099-01-02T00:00:00.000Z'),
        lastError: 'b',
      },
    ]);
    expect(got.get('o1')).toEqual([
      { rule: 'wake-awaiting-matching', row: 12, since: '2099-01-03T00:00:00.000Z', lastError: null },
      { rule: 'resume-pending-consolidation', row: 25, since: '2099-01-01T00:00:00.000Z', lastError: 'a' },
    ]);
    expect(got.get('o2')).toHaveLength(1);
  });

  it('주문 id 나 포기 시각이 없는 행은 버린다', () => {
    const got = groupGaveUpMarks([
      { salesOrderId: null, rule: 'r', row: 1, since: at('2099-01-01T00:00:00.000Z'), lastError: null },
      { salesOrderId: 'o', rule: 'r', row: 1, since: null, lastError: null },
    ]);
    expect(got.size).toBe(0);
  });
});
