import { PurchaseOrderService } from './purchase-order.service';
import { PurchaseOrderType } from '../dto/purchase-order.dto';

/** suppliers 조회 한 건만 태우는 최소 트랜잭션 흉내. */
function serviceWithSupplier(row: { defaultWarehouseId: string | null } | undefined) {
  const trx = {
    select: jest.fn(() => ({
      from: jest.fn(() => ({
        where: jest.fn(() => ({ limit: jest.fn().mockResolvedValue(row ? [row] : []) })),
      })),
    })),
  };
  const dbService = { run: jest.fn((fn: (executor: typeof trx) => unknown) => fn(trx)) };
  return new PurchaseOrderService(dbService as never, {} as never);
}

describe('PurchaseOrderService 공급사 기본 창고', () => {
  const dto = {
    type: PurchaseOrderType.DOMESTIC,
    supplierId: 'supplier-1',
    destinationWarehouseId: 'bucheon',
    lines: [{ skuId: 'sku-1', quantity: 10 }],
  };

  // 라이브 공급사 19곳이 전부 default_warehouse_id NULL 이라, 이 경로가 곧 "MD 가
  // 발주를 누를 때마다 보는 화면" 이다. 무엇을 해야 하는지 말해주지 않으면 MD 는
  // 막힌 이유를 알 수 없다 — 어드민 어디에도 그 값을 넣는 자리가 없었으니 더욱.
  it('기본 창고가 없으면 무엇을 해야 하는지 알려주며 거부한다', async () => {
    const service = serviceWithSupplier({ defaultWarehouseId: null });

    await expect(service.createPurchaseOrder(dto as never)).rejects.toThrow(/입고 창고/);
    await expect(service.createPurchaseOrder(dto as never)).rejects.toThrow(/공급처/);
  });
});
