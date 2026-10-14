import { ConflictError } from '@app/shared';
import { PurchaseOrderReceivingManager } from './purchase-order-receiving.manager';

function makeManager(status = 'ordered', expectedArrival = '2026-10-17', receivedQty = 0) {
  const steps: string[] = [];
  const rows = [
    [{ id: 'po-1', status: 'confirmed' }],
    [{ skuId: 'sku-1', status, expectedArrival, orderedQty: 10, receivedQty, closedAt: null }],
  ];
  const update = jest.fn(() => ({
    set: jest.fn(() => ({
      where: jest.fn(async () => {
        steps.push('write');
      }),
    })),
  }));
  const tx = {
    select: jest.fn(() => {
      const result = rows.shift() ?? [];
      const builder = {
        from: jest.fn(() => builder),
        where: jest.fn(() => builder),
        limit: jest.fn(() => builder),
        orderBy: jest.fn(() => builder),
        for: jest.fn(async () => result),
      };

      return builder;
    }),
    update,
  };
  const dbService = { run: jest.fn((fn: (executor: typeof tx) => unknown) => fn(tx)) };
  const projection = {
    recalculateAndPublishForSkus: jest.fn(async () => {
      steps.push('projection');
    }),
  };
  const reader = { findById: jest.fn().mockResolvedValue({ id: 'po-1' }) };
  const manager = new PurchaseOrderReceivingManager(
    dbService as never,
    {} as never,
    {} as never,
    {} as never,
    reader as never,
    projection as never,
  );

  return { manager, tx, projection, update, steps };
}

describe('발주 예정일 변경의 재입고 projection 반영', () => {
  it('변경된 라인을 저장한 뒤 해당 SKU만 같은 트랜잭션에서 반영한다', async () => {
    const { manager, tx, projection, steps } = makeManager();

    await manager.updateLineExpectedArrival('po-1', 'sku-1', { expectedArrival: '2026-10-20' });

    expect(steps).toEqual(['write', 'projection']);
    expect(projection.recalculateAndPublishForSkus).toHaveBeenCalledWith(['sku-1'], tx);
  });

  it('같은 날짜를 다시 저장하면 쓰기·재계산을 하지 않는다', async () => {
    const { manager, projection, update } = makeManager();

    await manager.updateLineExpectedArrival('po-1', 'sku-1', { expectedArrival: '2026-10-17' });

    expect(update).not.toHaveBeenCalled();
    expect(projection.recalculateAndPublishForSkus).not.toHaveBeenCalled();
  });

  it('입고완료 라인의 수정이 거절되면 projection도 발행하지 않는다', async () => {
    const { manager, projection, update } = makeManager('ordered', '2026-10-17', 10);

    await expect(manager.updateLineExpectedArrival('po-1', 'sku-1', { expectedArrival: '2026-10-20' })).rejects.toThrow(
      ConflictError,
    );

    expect(update).not.toHaveBeenCalled();
    expect(projection.recalculateAndPublishForSkus).not.toHaveBeenCalled();
  });
});
