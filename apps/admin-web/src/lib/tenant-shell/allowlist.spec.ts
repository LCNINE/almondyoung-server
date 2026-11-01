import { chooseTenantLanding, tenantShellScreenOf } from './allowlist';

const mine = (landingPath: string | null, permissions: string[]) => ({
  permissions: new Set(permissions),
  landingPath,
});

describe('tenantShellScreenOf — the tenant shell opens only its allowlist', () => {
  it.each([
    ['/inventory/warehouses', '/inventory/warehouses'],
    ['/inventory/warehouses/', '/inventory/warehouses'],
    ['/inventory/warehouses/new', '/inventory/warehouses/new'],
    ['/mall/products-list/abc-123', '/mall/products-list/[masterId]'],
    ['/mall/products-list/abc-123/versions', '/mall/products-list/[masterId]/versions'],
    ['/mall/bulk-sessions/7', '/mall/bulk-sessions/[id]'],
  ])('%s is the screen %s', (pathname, screen) => {
    expect(tenantShellScreenOf(pathname)).toBe(screen);
  });

  it.each([
    '/',
    '/order/history',
    '/inventory/status',
    '/mall/channel-listings',
    '/mall/products-list/abc/versions/extra',
    '/inventory/warehouses-old',
    '/company/my-account',
    '/account/change-password',
  ])('%s is not on the list', (pathname) => {
    expect(tenantShellScreenOf(pathname)).toBeNull();
  });
});

describe('chooseTenantLanding — where the tenant shell sends a person after sign-in', () => {
  const STAFF = ['inventory.stock.read', 'catalog.product.read'];

  it("goes to the role's landing screen when it is on the list and the person can open it", () => {
    expect(chooseTenantLanding(mine('/inventory/warehouses', STAFF))).toBe('/inventory/warehouses');
  });

  it('ignores a landing screen outside the list, and goes to the first menu screen the person can open', () => {
    expect(chooseTenantLanding(mine('/order/history', [...STAFF, 'order.order.read']))).toBe('/inventory/warehouses');
    expect(chooseTenantLanding(mine(null, ['catalog.product.read']))).toBe('/mall/products-list');
  });

  it('has nowhere to go when the person can open none of the list', () => {
    expect(chooseTenantLanding(mine('/inventory/warehouses', ['order.order.read']))).toBeNull();
  });
});
