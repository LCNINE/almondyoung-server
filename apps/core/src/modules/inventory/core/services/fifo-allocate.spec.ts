import { fifoAllocate, OnHandLedgerRow } from './fifo-allocate';

describe('fifoAllocate (출고 소진용 FIFO 로케이션 할당, 순수함수)', () => {
  const at = (iso: string) => new Date(iso);

  function row(overrides: Partial<OnHandLedgerRow> & { locationId: string; qty: number }): OnHandLedgerRow {
    return { fifoRank: null, updatedAt: at('2026-01-01T00:00:00.000Z'), ...overrides };
  }

  it('단일 로케이션에 충분하면 그 로케이션에서 정확히 소진할 chunk 하나를 만든다', () => {
    const rows = [row({ locationId: 'loc-A', qty: 10, fifoRank: 1 })];

    expect(fifoAllocate(rows, 10)).toEqual([{ locationId: 'loc-A', qty: 10 }]);
  });

  it('여러 로케이션은 fifoRank 오름차순으로 분할 소진한다 (입력 순서 무관)', () => {
    const rows = [
      row({ locationId: 'loc-B', qty: 5, fifoRank: 2 }),
      row({ locationId: 'loc-A', qty: 4, fifoRank: 1 }),
    ];

    expect(fifoAllocate(rows, 7)).toEqual([
      { locationId: 'loc-A', qty: 4 },
      { locationId: 'loc-B', qty: 3 },
    ]);
  });

  it('fifoRank 가 null 인 로케이션은 번호가 매겨진 로케이션보다 뒤(nulls last)', () => {
    const rows = [
      row({ locationId: 'loc-null', qty: 5, fifoRank: null }),
      row({ locationId: 'loc-A', qty: 3, fifoRank: 1 }),
    ];

    expect(fifoAllocate(rows, 6)).toEqual([
      { locationId: 'loc-A', qty: 3 },
      { locationId: 'loc-null', qty: 3 },
    ]);
  });

  it('fifoRank 가 모두 null 이면 updatedAt 오래된 로케이션부터 소진한다 (현 데이터의 실제 FIFO)', () => {
    const rows = [
      row({ locationId: 'loc-new', qty: 5, updatedAt: at('2026-02-01T00:00:00.000Z') }),
      row({ locationId: 'loc-old', qty: 3, updatedAt: at('2026-01-01T00:00:00.000Z') }),
    ];

    expect(fifoAllocate(rows, 6)).toEqual([
      { locationId: 'loc-old', qty: 3 },
      { locationId: 'loc-new', qty: 3 },
    ]);
  });

  it('가용 ON_HAND 합이 요청량보다 적으면 불변식 위반으로 throw', () => {
    const rows = [row({ locationId: 'loc-A', qty: 3, fifoRank: 1 })];

    expect(() => fifoAllocate(rows, 5)).toThrow();
  });
});
