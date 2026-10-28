import { REQUIRED_PERMISSIONS_KEY } from '@app/authorization';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { WarehouseController } from './warehouse.controller';

describe('WarehouseController authorization contract', () => {
  // Reflect.getMetadata 의 target 은 Object 를 요구한다. 여기서 한 번만 좁히고,
  // 핸들러가 없으면 즉시 던진다 — 이름이 바뀌면 조용히 통과하는 대신 터져야 한다.
  const handlerFor = (name: string): object => {
    const handler = Object.getOwnPropertyDescriptor(WarehouseController.prototype, name)?.value;
    if (!handler) throw new Error(`WarehouseController.${name} 핸들러가 없다 — 개명됐거나 삭제됐다`);
    return handler;
  };

  const WRITE_HANDLERS = ['create', 'update', 'remove'];
  const READ_HANDLERS = ['findAll', 'findOne', 'getStockSummary'];

  it.each(WRITE_HANDLERS)('closes %s behind the warehouse write permission', (name) => {
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, handlerFor(name))).toEqual(['inventory.warehouse.write']);
  });

  // warehouse-app 이 GET /inventory/warehouses 로 창고를 고르므로 읽기는 재고 조회 권한이면 된다.
  it.each(READ_HANDLERS)('opens %s to the stock read permission so the field PDA can read it', (name) => {
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, handlerFor(name))).toEqual(['inventory.stock.read']);
  });

  it('carries no legacy guard or class-level requirement on the controller', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, WarehouseController)).toBeUndefined();
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, WarehouseController)).toBeUndefined();
  });

  it('still delegates to the service through the mapper', async () => {
    // 필드 구성은 warehouses 테이블(inventory.schema.ts:726-735) 그대로다.
    // type 은 warehouseTypeEnum = ['domestic','overseas','bonded','return'] 중 하나여야 한다.
    const warehouse = {
      id: 'w-1',
      name: '부천 물류창고',
      type: 'domestic' as const,
      location: '부천',
      supportedPickingStrategies: null,
      createdAt: new Date('2026-07-28T00:00:00.000Z'),
      updatedAt: new Date('2026-07-28T00:00:00.000Z'),
    };
    const service = { update: jest.fn().mockResolvedValue(warehouse) };
    const controller = new WarehouseController(service as never);

    const result = await controller.update('w-1', { supportedPickingStrategies: ['discrete'] });

    expect(service.update).toHaveBeenCalledWith('w-1', { supportedPickingStrategies: ['discrete'] });
    expect(result.supportedPickingStrategies).toEqual([]);
  });
});
