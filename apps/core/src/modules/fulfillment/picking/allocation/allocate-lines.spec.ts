import { ConflictException } from '@nestjs/common';
import { allocateLines } from './allocate-lines';
import { SourceCapacity } from './allocation.types';

const cap = (skuId: string, sourceLocationId: string, remainingQty: number, stockVersion = 1): SourceCapacity => ({
  skuId,
  sourceLocationId,
  remainingQty,
  stockVersion,
});

describe('allocateLines', () => {
  it('줄 id 순, 위치 id 순으로 선착 배정하고 작업 항목 id 를 싣는다', () => {
    const drafts = allocateLines(
      [
        { id: 'line-b', skuId: 'sku-1', qty: 3, workItemId: 'wi-2' },
        { id: 'line-a', skuId: 'sku-1', qty: 2, workItemId: 'wi-1' },
      ],
      [cap('sku-1', 'loc-2', 10, 7), cap('sku-1', 'loc-1', 3, 5)],
    );
    expect(drafts).toEqual([
      { workItemId: 'wi-1', shipmentLineId: 'line-a', sourceLocationId: 'loc-1', qty: 2, sourceStockVersion: 5 },
      { workItemId: 'wi-2', shipmentLineId: 'line-b', sourceLocationId: 'loc-1', qty: 1, sourceStockVersion: 5 },
      { workItemId: 'wi-2', shipmentLineId: 'line-b', sourceLocationId: 'loc-2', qty: 2, sourceStockVersion: 7 },
    ]);
  });

  it('다른 SKU 의 용량은 쓰지 않는다', () => {
    expect(() =>
      allocateLines([{ id: 'line-a', skuId: 'sku-1', qty: 1, workItemId: 'wi-1' }], [cap('sku-2', 'loc-1', 5)]),
    ).toThrow(ConflictException);
  });

  it('모자라면 PICKING_SOURCE_INSUFFICIENT 를 던지고 부분 결과를 돌려주지 않는다', () => {
    let error: unknown;
    try {
      allocateLines(
        [
          { id: 'line-a', skuId: 'sku-1', qty: 2, workItemId: 'wi-1' },
          { id: 'line-b', skuId: 'sku-1', qty: 2, workItemId: 'wi-2' },
        ],
        [cap('sku-1', 'loc-1', 3)],
      );
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({ code: 'PICKING_SOURCE_INSUFFICIENT' });
  });

  it('입력 용량 배열을 변경하지 않는다', () => {
    const capacities = [cap('sku-1', 'loc-1', 5)];
    allocateLines([{ id: 'line-a', skuId: 'sku-1', qty: 2, workItemId: 'wi-1' }], capacities);
    expect(capacities[0].remainingQty).toBe(5);
  });
});
