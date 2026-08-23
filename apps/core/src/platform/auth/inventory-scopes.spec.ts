import { INVENTORY_ROLE_MAPPINGS, INVENTORY_SCOPE, INVENTORY_SCOPES } from './inventory-scopes';

describe('inventory authorization contract', () => {
  const roleScopes = new Map(INVENTORY_ROLE_MAPPINGS.map((mapping) => [mapping.roleName, mapping.scopeKeys]));
  const sorted = (roleName: string) => [...(roleScopes.get(roleName) ?? [])].sort();

  it('registers four inventory scopes under the inventory category', () => {
    expect([...INVENTORY_SCOPES.map((scope) => scope.key)].sort()).toEqual([
      'inventory.adjust',
      'inventory.manage',
      'inventory.operate',
      'inventory.warehouse.manage',
    ]);
    expect(INVENTORY_SCOPES.every((scope) => scope.category === 'inventory')).toBe(true);
    expect(INVENTORY_SCOPES.every((scope) => scope.description.length > 0)).toBe(true);
  });

  // admin-web 의 inventory 화면 15개가 전부 requireRole={['admin','master']} 다.
  // admin 이 네 스코프를 다 갖지 않으면 화면에는 들어가고 저장에서 403 을 받는다.
  it('grants every inventory scope to admin', () => {
    expect(sorted('admin')).toEqual([
      'inventory.adjust',
      'inventory.manage',
      'inventory.operate',
      'inventory.warehouse.manage',
    ]);
  });

  it('grants every inventory scope to the logistics manager', () => {
    expect(sorted('logistics_manager')).toEqual([
      'inventory.adjust',
      'inventory.manage',
      'inventory.operate',
      'inventory.warehouse.manage',
    ]);
  });

  // 현장 작업자는 operate 하나만 받는다. 원장 직접 조작(adjust)·마스터데이터(manage)·
  // 창고 설정(warehouse.manage)은 작업자 권한이 아니다.
  it('grants only operate to the logistics worker', () => {
    expect(sorted('logistics_worker')).toEqual(['inventory.operate']);
  });

  it('never grants adjust or manage to the logistics worker', () => {
    expect(roleScopes.get('logistics_worker')).not.toContain(INVENTORY_SCOPE.ADJUST);
    expect(roleScopes.get('logistics_worker')).not.toContain(INVENTORY_SCOPE.MANAGE);
    expect(roleScopes.get('logistics_worker')).not.toContain(INVENTORY_SCOPE.WAREHOUSE_MANAGE);
  });
});
