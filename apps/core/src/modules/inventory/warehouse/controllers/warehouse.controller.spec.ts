import { REQUIRED_SCOPES_KEY, ScopeGuard } from '@app/authorization';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { INVENTORY_SCOPE } from '../../../../platform/auth/inventory-scopes';
import { WarehouseController } from './warehouse.controller';

describe('WarehouseController authorization contract', () => {
  const handlerFor = (name: string): unknown =>
    Object.getOwnPropertyDescriptor(WarehouseController.prototype, name)?.value;

  const WRITE_HANDLERS = ['create', 'update', 'remove'];
  const READ_HANDLERS = ['findAll', 'findOne', 'getStockSummary'];

  it.each(WRITE_HANDLERS)('closes %s behind the warehouse management scope', (name) => {
    const handler = handlerFor(name);
    expect(handler).toBeDefined();
    expect(Reflect.getMetadata(REQUIRED_SCOPES_KEY, handler)).toEqual([INVENTORY_SCOPE.WAREHOUSE_MANAGE]);
  });

  // RequireScopes 는 메타데이터일 뿐이라 ScopeGuard 가 없으면 아무것도 막지 못한다.
  // 데코레이터 하나만 붙이고 끝내는 회귀를 이 어서션이 잡는다.
  it.each(WRITE_HANDLERS)('binds ScopeGuard to %s so the metadata is actually enforced', (name) => {
    expect(Reflect.getMetadata(GUARDS_METADATA, handlerFor(name))).toEqual([ScopeGuard]);
  });

  // warehouse-app 이 GET /inventory/warehouses 로 창고를 고르는데 현장 토큰의 role 을
  // 코드로 확인할 수 없다. 읽기를 닫으면 현장 PDA 가 창고 선택조차 못 한다.
  it.each(READ_HANDLERS)('leaves %s open to any authenticated caller', (name) => {
    const handler = handlerFor(name);
    expect(handler).toBeDefined();
    expect(Reflect.getMetadata(REQUIRED_SCOPES_KEY, handler)).toBeUndefined();
    expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toBeUndefined();
  });

  it('does not put a class-level scope requirement on the controller', () => {
    expect(Reflect.getMetadata(REQUIRED_SCOPES_KEY, WarehouseController)).toBeUndefined();
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
