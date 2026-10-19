import { chooseLanding } from './landing';

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
