import { REQUIRED_SCOPES_KEY, ScopeGuard } from '@app/authorization';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { INVENTORY_SCOPE } from '../../../../platform/auth/inventory-scopes';
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

  it.each(WRITE_HANDLERS)('closes %s behind the warehouse management scope', (name) => {
    const handler = handlerFor(name);
    expect(handler).toBeDefined();
    expect(Reflect.getMetadata(REQUIRED_SCOPES_KEY, handler)).toEqual([INVENTORY_SCOPE.WAREHOUSE_MANAGE]);
  });

  // RequireScopes 는 메타데이터일 뿐이라 ScopeGuard 가 없으면 아무것도 막지 못한다.
  // 데코레이터 하나만 붙이고 끝내는 회귀를 이 어서션이 잡는다. #551 에서 가드가 클래스
  // 레벨로 올라갔다 — inventory 컨트롤러 18개가 모두 같은 형태다.
  it('binds ScopeGuard at the controller level so every scoped handler is enforced', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, WarehouseController)).toEqual([ScopeGuard]);
  });

  // #546 은 읽기를 무표시로 뒀지만, 그건 열려 있던 게 아니라 AdminRealmGuard 가
  // admin/master 로 막고 있던 것이다. warehouse-app 이 GET /inventory/warehouses 로 창고를
  // 고르므로 #551 에서 읽기에 OPERATE 를 준다 — logistics_worker 가 통과하게 만드는 게 목적이다.
  it.each(READ_HANDLERS)('opens %s to inventory.operate so the field PDA can read it', (name) => {
    expect(Reflect.getMetadata(REQUIRED_SCOPES_KEY, handlerFor(name))).toEqual([INVENTORY_SCOPE.OPERATE]);
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
