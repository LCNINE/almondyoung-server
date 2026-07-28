import { INVENTORY_ROLE_MAPPINGS, INVENTORY_SCOPE, INVENTORY_SCOPES } from './inventory-scopes';

describe('inventory authorization contract', () => {
  const roleScopes = new Map(INVENTORY_ROLE_MAPPINGS.map((mapping) => [mapping.roleName, mapping.scopeKeys]));

  it('registers the warehouse management scope under the inventory category', () => {
    expect(INVENTORY_SCOPES.map((scope) => scope.key)).toEqual(['inventory.warehouse.manage']);
    expect(INVENTORY_SCOPES.every((scope) => scope.category === 'inventory')).toBe(true);
  });

  it('grants warehouse management to admin and the logistics manager, never to the worker', () => {
    expect(roleScopes.get('admin')).toEqual([INVENTORY_SCOPE.WAREHOUSE_MANAGE]);
    expect(roleScopes.get('logistics_manager')).toEqual([INVENTORY_SCOPE.WAREHOUSE_MANAGE]);
    expect(roleScopes.get('logistics_worker')).toBeUndefined();
  });
});
