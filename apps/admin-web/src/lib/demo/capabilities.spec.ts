import {
  isDemoUnavailablePath,
  isDemoConsoleEnabled,
  filterDemoMenus,
} from './capabilities';

describe('demo capability boundaries', () => {
  it.each([
    '/api/proxy/wallet/payments',
    '/api/proxy/medusa/admin/orders',
    '/membership/members',
    '/mall/shipping-groups',
    '/mall/regions',
    '/statistics/keywords',
    '/api/ai/product-description',
  ])('disables absent/external dependency %s', (path) => {
    expect(isDemoUnavailablePath(path)).toBe(true);
  });
  it.each([
    '/api/proxy/api/sales-orders',
    '/inventory/replenishment',
    '/order/outbound-batches',
    '/mall/products-list',
    '/demo',
  ])('preserves logistics path %s', (path) => {
    expect(isDemoUnavailablePath(path)).toBe(false);
  });
  it('requires the exact demo stage plus the explicit server flag', () => {
    expect(
      isDemoConsoleEnabled({
        APP_STAGE: 'live',
        DEMO_CONSOLE_ENABLED: 'true',
        EXTERNAL_INTEGRATIONS_MODE: 'mock',
      })
    ).toBe(false);
    expect(isDemoConsoleEnabled({ APP_STAGE: 'demo' })).toBe(false);
    expect(
      isDemoConsoleEnabled({
        APP_STAGE: 'demo',
        DEMO_CONSOLE_ENABLED: 'true',
        EXTERNAL_INTEGRATIONS_MODE: 'mock',
      })
    ).toBe(true);
  });
  it('removes empty menu groups and repairs defaults that point at removed services', () => {
    expect(
      filterDemoMenus([
        {
          id: 'payment',
          title: '결제',
          icon: 'Store',
          children: [{ id: 'pay', title: '결제', path: '/payments' }],
        },
        {
          id: 'mixed',
          title: '업무',
          icon: 'Package',
          defaultPath: '/membership/members',
          children: [
            { id: 'membership', title: '회원', path: '/membership/members' },
            { id: 'stock', title: '재고', path: '/inventory/status' },
          ],
        },
      ])
    ).toEqual([
      {
        id: 'mixed',
        title: '업무',
        icon: 'Package',
        defaultPath: '/inventory/status',
        children: [{ id: 'stock', title: '재고', path: '/inventory/status' }],
      },
    ]);
  });
});
