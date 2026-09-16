import type { MainMenu, MenuItem } from '../utils/menu';

const DISABLED_PREFIXES = [
  '/payments',
  '/membership',
  '/account/sales-channel/medusa-customers',
  '/cs/reviews',
  '/cs/qna',
  '/statistics/keywords',
  '/statistics/traffic',
  '/statistics/reviews',
  '/statistics/behavior',
  '/mall/marketing',
  '/mall/shipping-groups',
  '/mall/regions',
  '/mall/digital-assets',
  '/mall/ownerships',
  '/mall/shop-listings',
  '/api/ai',
  '/api/proxy/medusa',
  '/api/proxy/wallet',
  '/api/proxy/membership',
  '/api/proxy/ugc',
  '/api/proxy/search',
];

export function isDemoUnavailablePath(path: string): boolean {
  const normalized = path.startsWith('/proxy/') ? `/api${path}` : path;
  return DISABLED_PREFIXES.some(
    (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`)
  );
}

export function isDemoConsoleEnabled(
  env: Record<string, string | undefined>
): boolean {
  return (
    env.APP_STAGE === 'demo' &&
    env.DEMO_CONSOLE_ENABLED === 'true' &&
    env.EXTERNAL_INTEGRATIONS_MODE === 'mock'
  );
}

export function filterDemoMenus(menus: MainMenu[]): MainMenu[] {
  function filter(items: MenuItem[]): MenuItem[] {
    return items.flatMap((item) => {
      if (item.path && isDemoUnavailablePath(item.path)) return [];
      const children = item.children ? filter(item.children) : undefined;
      if (children?.length === 0 && !item.path) return [];
      return [{ ...item, ...(children ? { children } : {}) }];
    });
  }
  function firstPath(items: MenuItem[]): string | undefined {
    for (const item of items) {
      const path = item.path ?? (item.children && firstPath(item.children));
      if (path) return path;
    }
  }
  return menus.flatMap((menu) => {
    const children = filter(menu.children);
    if (!children.length) return [];
    return [
      {
        ...menu,
        children,
        defaultPath:
          menu.defaultPath && !isDemoUnavailablePath(menu.defaultPath)
            ? menu.defaultPath
            : firstPath(children),
      },
    ];
  });
}
