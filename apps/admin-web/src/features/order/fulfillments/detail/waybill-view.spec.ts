import {
  shownWaybillActions,
  splitWaybills,
  waybillNextStep,
} from './waybill-view';

const waybill = (id: string, status: string) => ({ id, status });

describe('splitWaybills', () => {
  it('끝나지 않은 송장을 지금 쓸 송장으로, 무효·실패·중단은 최근 것부터 지난 송장으로 둔다', () => {
    const { current, past } = splitWaybills([
      waybill('a', 'voided'),
      waybill('b', 'failed'),
      waybill('c', 'registered'),
      waybill('d', 'abandoned'),
    ]);

    expect(current?.id).toBe('c');
    expect(past.map((w) => w.id)).toEqual(['d', 'b', 'a']);
  });

  it('지금 쓸 송장이 없으면 null', () => {
    expect(splitWaybills([waybill('a', 'voided')]).current).toBeNull();
    expect(splitWaybills([]).current).toBeNull();
  });
});

describe('waybillNextStep', () => {
  const box = (
    status: string,
    waybills: Array<{ status: string }>,
    workItems: Array<{ status: string; batchId?: string }> = []
  ) => ({ status, waybills, workItems });

  it('사용 가능한 송장이 있고 배치에 없으면 출고 준비로 잇는다', () => {
    expect(waybillNextStep(box('planned', [{ status: 'registered' }]))).toEqual(
      { kind: 'prepare' }
    );
  });

  it('배치에서 빠졌거나 끝난 작업만 있으면 배치에 없는 것으로 본다', () => {
    expect(
      waybillNextStep(
        box(
          'planned',
          [{ status: 'registered' }],
          [{ status: 'excluded', batchId: 'b-1' }]
        )
      )
    ).toEqual({ kind: 'prepare' });
  });

  it('배치에 들어 있으면 그 배치에서 출력하도록 배치를 알려 준다', () => {
    expect(
      waybillNextStep(
        box(
          'planned',
          [{ status: 'registered' }],
          [
            { status: 'excluded', batchId: 'b-old' },
            { status: 'picking', batchId: 'b-1' },
          ]
        )
      )
    ).toEqual({ kind: 'print', batchId: 'b-1' });
  });

  it('출고에 쓴 송장이면 할 일이 없다', () => {
    expect(waybillNextStep(box('shipped', [{ status: 'used' }]))).toEqual({
      kind: 'shipped',
    });
  });

  it('발급 중이면 기다린다', () => {
    expect(waybillNextStep(box('planned', [{ status: 'allocated' }]))).toEqual({
      kind: 'issuing',
    });
  });

  it('배치에 든 상자의 송장이 없어지면 출고 준비가 아니라 그 배치에서 이어 간다', () => {
    expect(
      waybillNextStep(
        box(
          'planned',
          [{ status: 'voided' }],
          [{ status: 'packing', batchId: 'b-1' }]
        )
      )
    ).toEqual({ kind: 'issue-in-batch', batchId: 'b-1' });
  });

  it('송장이 없으면 계획 확정 상자는 발급, 계획 전 상자는 계획 확정이 먼저다', () => {
    expect(waybillNextStep(box('planned', [{ status: 'voided' }]))).toEqual({
      kind: 'issue',
    });
    expect(waybillNextStep(box('draft', []))).toEqual({ kind: 'plan-first' });
    expect(waybillNextStep(box('shipped', []))).toEqual({ kind: 'none' });
  });
});

describe('shownWaybillActions', () => {
  it('송장이 없는 계획 확정 상자는 발급·수동 등록만', () => {
    expect(shownWaybillActions('planned', null)).toEqual(['issue', 'manual']);
  });

  it('사용 가능한 송장이 있으면 재발급·무효화만', () => {
    expect(shownWaybillActions('planned', { status: 'registered' })).toEqual([
      'reissue',
      'void',
    ]);
  });

  it('계획 전 상자는 새로 발급하지 않고, 남은 송장은 무효화만 한다', () => {
    expect(shownWaybillActions('draft', null)).toEqual([]);
    expect(shownWaybillActions('draft', { status: 'registered' })).toEqual([
      'void',
    ]);
  });

  it('발급 대기 중인 송장은 같은 발급으로 이어 갈 수 있게 발급만 둔다', () => {
    expect(shownWaybillActions('planned', { status: 'pending' })).toEqual([
      'issue',
    ]);
    expect(shownWaybillActions('planned', { status: 'allocated' })).toEqual([]);
  });

  it('출고에 쓴 송장이나 출고 뒤 상자에 남은 송장은 버튼이 없다', () => {
    expect(shownWaybillActions('shipped', { status: 'used' })).toEqual([]);
    for (const status of ['shipped', 'in_transit', 'delivered']) {
      expect(shownWaybillActions(status, { status: 'registered' })).toEqual([]);
    }
  });
});
