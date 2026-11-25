import { isKeptApart, keptApartSplitsOf, SplitOperation, splitFamilyRoot, splitReasonOf } from './split-families';

function operation(id: string, patch: Partial<SplitOperation> = {}): [string, SplitOperation] {
  return [id, { id, reason: '나눔', reasonCode: null, completedAtMicros: 1, ...patch }];
}

describe('keptApartSplitsOf', () => {
  it('크기 때문에 나눈 작업의 상자를 한 묶음으로 둔다', () => {
    const families = keptApartSplitsOf(
      [
        { operationId: 'op1', shipmentId: 'a' },
        { operationId: 'op1', shipmentId: 'b' },
      ],
      new Map([operation('op1', { reasonCode: 'does_not_fit' })]),
    );

    expect(isKeptApart(families, 'a', 'b')).toBe(true);
  });

  it('다른 사유로 나눈 상자는 넣지 않는다', () => {
    const families = keptApartSplitsOf(
      [
        { operationId: 'op1', shipmentId: 'a' },
        { operationId: 'op1', shipmentId: 'b' },
      ],
      new Map([operation('op1', { reasonCode: 'ship_available_first' })]),
    );

    expect(families.size).toBe(0);
    expect(isKeptApart(families, 'a', 'b')).toBe(false);
  });

  it('크기로 나눈 한쪽을 다른 이유로 다시 나누면 그 둘은 짝이 되고 반대쪽과는 떨어져 있다', () => {
    const families = keptApartSplitsOf(
      [
        { operationId: 'op1', shipmentId: 'a' },
        { operationId: 'op1', shipmentId: 'b' },
        { operationId: 'op2', shipmentId: 'b' },
        { operationId: 'op2', shipmentId: 'c' },
      ],
      new Map([operation('op1', { reasonCode: 'does_not_fit' }), operation('op2', { reasonCode: 'other' })]),
    );

    expect(isKeptApart(families, 'a', 'c')).toBe(true);
    expect(isKeptApart(families, 'b', 'c')).toBe(false);
  });

  it('나뉜 적 없는 상자와는 떨어뜨리지 않는다', () => {
    const families = keptApartSplitsOf(
      [
        { operationId: 'op1', shipmentId: 'a' },
        { operationId: 'op1', shipmentId: 'b' },
      ],
      new Map([operation('op1', { reasonCode: 'does_not_fit' })]),
    );

    expect(isKeptApart(families, 'a', 'x')).toBe(false);
    expect(isKeptApart(families, 'x', 'y')).toBe(false);
  });
});

describe('splitReasonOf', () => {
  const links = [
    { operationId: 'op1', shipmentId: 'a' },
    { operationId: 'op1', shipmentId: 'b' },
    { operationId: 'op2', shipmentId: 'b' },
    { operationId: 'op2', shipmentId: 'c' },
  ];

  it('가장 최근에 든 나누기의 정해 둔 사유 이름을 준다', () => {
    const operations = new Map([
      operation('op1', { reasonCode: 'ship_available_first', completedAtMicros: 1 }),
      operation('op2', { reasonCode: 'does_not_fit', completedAtMicros: 2 }),
    ]);

    expect(splitReasonOf('b', links, operations)).toEqual({
      reasonCode: 'does_not_fit',
      reason: '한 상자에 다 들어가지 않음',
    });
    expect(splitReasonOf('a', links, operations)).toEqual({
      reasonCode: 'ship_available_first',
      reason: '일부 상품 재고가 늦어 있는 것부터 보냄',
    });
  });

  it('완료 시각이 같으면 작업 id 로 한쪽을 고른다', () => {
    const operations = new Map([
      operation('op1', { reasonCode: 'ship_available_first', completedAtMicros: 5 }),
      operation('op2', { reasonCode: 'does_not_fit', completedAtMicros: 5 }),
    ]);

    expect(splitReasonOf('b', links, operations)?.reasonCode).toBe('does_not_fit');
    expect(splitReasonOf('b', [...links].reverse(), operations)?.reasonCode).toBe('does_not_fit');
  });

  it('기타와 코드 없는 옛 기록은 적어 둔 글을 그대로 준다', () => {
    expect(
      splitReasonOf('a', links, new Map([operation('op1', { reasonCode: 'other', reason: '고객 선물 포장' })])),
    ).toEqual({ reasonCode: 'other', reason: '고객 선물 포장' });
    expect(splitReasonOf('a', links, new Map([operation('op1', { reason: '나눠 보내기' })]))).toEqual({
      reasonCode: null,
      reason: '나눠 보내기',
    });
  });

  it('코드 없이 남은 출고 준비 자동 기록도 사유 이름으로 읽는다', () => {
    expect(
      splitReasonOf('a', links, new Map([operation('op1', { reason: '출고 준비: 있는 것만 먼저 보내기' })])),
    ).toEqual({ reasonCode: 'ship_available_first', reason: '일부 상품 재고가 늦어 있는 것부터 보냄' });
  });

  it('나눈 적 없는 상자는 null', () => {
    expect(splitReasonOf('x', links, new Map([operation('op1')]))).toBeNull();
  });
});

describe('splitFamilyRoot', () => {
  it('읽은 순서와 상관없이 묶음 안 가장 작은 상자 id 를 키로 쓴다', () => {
    const links = [
      { operationId: 'op1', shipmentId: 'c' },
      { operationId: 'op1', shipmentId: 'b' },
      { operationId: 'op2', shipmentId: 'b' },
      { operationId: 'op2', shipmentId: 'a' },
    ];

    for (const order of [links, [...links].reverse()]) {
      const root = splitFamilyRoot(order);

      expect(['a', 'b', 'c'].map(root)).toEqual(['a', 'a', 'a']);
    }
  });
});
