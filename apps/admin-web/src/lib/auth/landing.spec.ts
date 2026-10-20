import { chooseLanding, homeRedirect } from './landing';
import { firstAccessiblePath } from './screen-access';
import { mainMenus } from '@/lib/utils/menu';

const mine = (landingPath: string | null, permissions: string[]) => ({
  roles: [],
  permissions: new Set(permissions),
  version: 'v',
  landingPath,
});

describe('chooseLanding', () => {
  it('goes to the role landing screen after a default sign-in', () => {
    expect(
      chooseLanding(mine('/order/history', ['order.order.read']), '/')
    ).toBe('/order/history');
  });

  it('keeps a page the person was heading to', () => {
    expect(
      chooseLanding(
        mine('/order/history', ['order.order.read']),
        '/inventory/status'
      )
    ).toBe('/inventory/status');
  });

  it('ignores a landing screen the person cannot open', () => {
    expect(
      chooseLanding(mine('/statistics/profit', ['order.order.read']), '/')
    ).toBe('/');
  });

  it('ignores a landing path that is not a known screen', () => {
    expect(chooseLanding(mine('/nowhere', ['order.order.read']), '/')).toBe(
      '/'
    );
  });

  it('stays on the default when no role sets a landing screen', () => {
    expect(chooseLanding(mine(null, ['order.order.read']), '/')).toBe('/');
  });
});

describe('homeRedirect', () => {
  // `/`(대시보드)를 못 여는 사람이 `/` 에 왔을 때 — 첫 비밀번호 변경 뒤나 로고 클릭.
  it('prefers the role landing screen over the first sidebar menu', () => {
    expect(
      homeRedirect(
        mine('/mobile/sku-field-capture', ['inventory.stock.read']),
        mainMenus
      )
    ).toBe('/mobile/sku-field-capture');
  });

  it('falls back to the first sidebar menu without a usable landing screen', () => {
    const held = ['inventory.stock.read'];
    expect(homeRedirect(mine(null, held), mainMenus)).toBe(
      firstAccessiblePath(mainMenus, new Set(held))
    );
    expect(homeRedirect(mine('/statistics/profit', held), mainMenus)).toBe(
      firstAccessiblePath(mainMenus, new Set(held))
    );
  });
});
