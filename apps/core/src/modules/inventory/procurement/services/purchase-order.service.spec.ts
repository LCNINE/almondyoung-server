import { HttpException } from '@nestjs/common';
import { NotFoundError } from '@app/shared';
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

/**
 * 이 파일은 `@nestjs/common` 예외(10곳)와 `@app/shared` 예외(6곳)를 **동시에** 던지고 있었다.
 * CLAUDE.md §Error handling 은 Service 층이 `HttpException` 을 알지 못하게 하라고 못 박는다 —
 * 상태코드 매핑은 `GlobalExceptionFilter` 의 일이다.
 *
 * 상태코드는 그대로 보존한다: NotFoundException→NotFoundError(404), BadRequestException→
 * BadRequestError(400). 의미상 409 인 곳이 하나 있으나(라인 수정을 received 에서 거부) 그건
 * API 계약 변경이라 여기서 손대지 않는다 — #745.
 */
describe('PurchaseOrderService 예외 규약', () => {
  function serviceWithNoRows() {
    const trx = {
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({ limit: jest.fn().mockResolvedValue([]) })),
        })),
      })),
    };
    const dbService = { run: jest.fn((fn: (executor: typeof trx) => unknown) => fn(trx)) };
    return new PurchaseOrderService(dbService as never, {} as never);
  }

  it('없는 발주 조회는 @app/shared 의 NotFoundError 를 던진다 (Nest 예외가 아니다)', async () => {
    const service = serviceWithNoRows();
    await expect(service.getPurchaseOrderById('missing-po')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('없는 발주 조회가 HttpException 계열을 던지지 않는다', async () => {
    const service = serviceWithNoRows();
    await expect(service.getPurchaseOrderById('missing-po')).rejects.not.toBeInstanceOf(HttpException);
  });
});
