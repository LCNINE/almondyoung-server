import { describe, expect, it } from 'vitest';
import type { StoredOperation } from './operationStore';
import { otherWorkName } from './workArea';

const op = (path: string) => ({ id: path, path }) as StoredOperation;

describe('otherWorkName', () => {
  it('상자 작업만 남았으면 없다', () => {
    expect(
      otherWorkName([op('/shipments/s-1/simple-outbound-scans')])
    ).toBeNull();
  });

  it('남은 작업의 이름을 알린다 — 입고 경로의 적치는 적치로', () => {
    expect(otherWorkName([op('/inbound/simple')])).toBe('입고');
    expect(otherWorkName([op('/inbound/putaway')])).toBe('적치·이동');
    expect(otherWorkName([op('/inventory/stocks/adjust')])).toBe('재고 조정');
    expect(
      otherWorkName([
        op('/stocktaking/scan-product'),
        op('/stocktaking/count-items'),
      ])
    ).toBe('실사');
  });

  it('여러 종류이거나 모르는 작업이면 «다른»', () => {
    expect(otherWorkName([op('/inbound/simple'), op('/movement/move')])).toBe(
      '다른'
    );
    expect(otherWorkName([op('/somewhere/else')])).toBe('다른');
  });
});
