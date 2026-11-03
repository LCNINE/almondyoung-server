import {
  mergedHeading,
  mergingHeading,
  nextStepsAfterMerge,
} from './consolidation-copy';

describe('mergingHeading', () => {
  it('두 주문이면 받침에 맞춰 조사를 붙인다', () => {
    expect(mergingHeading(['6314', '6275'])).toBe(
      '#6314와 #6275를 합치는 중이에요'
    );
    expect(mergingHeading(['6275', '6310'])).toBe(
      '#6275와 #6310을 합치는 중이에요'
    );
    expect(mergingHeading(['6313', '6314'])).toBe(
      '#6313과 #6314를 합치는 중이에요'
    );
  });

  it('셋 이상이면 첫 주문 외 몇 건으로 줄인다', () => {
    expect(mergingHeading(['1', '2', '3'])).toBe('#1 외 2건을 합치는 중이에요');
  });

  it('같은 주문번호는 한 번만 세고, 둘이 안 되면 null', () => {
    expect(mergingHeading(['1', '1'])).toBeNull();
    expect(mergingHeading([])).toBeNull();
  });
});

describe('mergedHeading', () => {
  it('합쳐진 주문을 새 상자 하나로 말한다', () => {
    expect(mergedHeading(['6275', '6314'])).toBe(
      '#6275와 #6314가 새 상자 하나로 합쳐졌어요'
    );
    expect(mergedHeading(['6314', '6275'])).toBe(
      '#6314와 #6275가 새 상자 하나로 합쳐졌어요'
    );
    expect(mergedHeading(['1', '2', '3'])).toBe(
      '#1 외 2건이 새 상자 하나로 합쳐졌어요'
    );
  });
});

describe('nextStepsAfterMerge', () => {
  const target = (
    overrides: Partial<Parameters<typeof nextStepsAfterMerge>[0]> = {}
  ) => ({
    status: 'draft',
    waybills: [] as Array<{ voidedAt: string | null }>,
    workItems: [] as Array<{ status: string }>,
    ...overrides,
  });

  it('새 상자는 계획 확정부터', () => {
    expect(nextStepsAfterMerge(target())).toEqual([
      { key: 'plan', title: '계획 확정', state: 'current' },
      { key: 'waybill', title: '운송장 발급', state: 'later' },
      { key: 'batch', title: '배치 넣기', state: 'later' },
    ]);
  });

  it('계획이 확정되면 운송장 발급이 지금 할 일', () => {
    expect(
      nextStepsAfterMerge(target({ status: 'planned' })).map((s) => s.state)
    ).toEqual(['done', 'current', 'later']);
  });

  it('취소된 송장은 발급으로 치지 않는다', () => {
    expect(
      nextStepsAfterMerge(
        target({
          status: 'planned',
          waybills: [{ voidedAt: '2026-11-02T00:00:00Z' }],
        })
      ).map((s) => s.state)
    ).toEqual(['done', 'current', 'later']);
  });

  it('송장이 있으면 배치 넣기가 지금 할 일이고, 빠진 항목은 넣은 것으로 안 센다', () => {
    const steps = (status: string) =>
      nextStepsAfterMerge(
        target({
          status: 'planned',
          waybills: [{ voidedAt: null }],
          workItems: [{ status }],
        })
      ).map((s) => s.state);

    expect(steps('excluded')).toEqual(['done', 'done', 'current']);
    expect(steps('queued')).toEqual(['done', 'done', 'done']);
  });
});
