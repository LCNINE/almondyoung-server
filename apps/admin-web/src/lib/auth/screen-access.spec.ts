import type { MainMenu, MenuItem } from '../utils/menu';
import { permissionLabel, readRequiredPermissions } from './permission-labels';
import { canAccess, filterMenuItems, firstAccessiblePath, firstAccessiblePathIn, resolveScreenAccess } from './screen-access';

const held = (...keys: string[]) => new Set(keys);

describe('resolveScreenAccess', () => {
  it('uses the exact screen entry', () => {
    expect(resolveScreenAccess('/order/history')).toEqual({ kind: 'permission', anyOf: ['order.order.read'] });
  });

  it('lets a detail screen inherit the closest parent entry', () => {
    expect(resolveScreenAccess('/mall/banner-groups/[id]')).toEqual(resolveScreenAccess('/mall/banner-groups'));
    expect(resolveScreenAccess('/mall/products-list/[masterId]/versions')).toEqual(resolveScreenAccess('/mall/products-list'));
  });

  it('prefers a more specific entry over its parent', () => {
    expect(resolveScreenAccess('/cs/reviews/new')).toEqual({ kind: 'permission', anyOf: ['cs.review.moderate'] });
  });

  it('never falls back to the dashboard entry', () => {
    expect(resolveScreenAccess('/no-such-area/page')).toBeUndefined();
  });
});

describe('canAccess', () => {
  it('needs any one of the listed permissions', () => {
    const mobile = resolveScreenAccess('/mobile/pick');
    expect(mobile && canAccess(mobile, held('fulfillment.shipment.read'))).toBe(true);
    expect(mobile && canAccess(mobile, held('order.order.read'))).toBe(false);
  });

  it('lets anyone signed in through an authenticated screen', () => {
    const mine = resolveScreenAccess('/company/my-account');
    expect(mine && canAccess(mine, held())).toBe(true);
  });
});

const item = (id: string, path?: string, children?: MenuItem[], isComingSoon?: boolean): MenuItem => ({ id, title: id, path, children, isComingSoon });
const menus: MainMenu[] = [
  { id: 'company', title: 'c', icon: 'Users', children: [item('mine', '/company/my-account'), item('users', '/users')] },
  { id: 'order', title: 'o', icon: 'Box', children: [item('group', undefined, [item('history', '/order/history'), item('soon', undefined, undefined, true)])] },
  { id: 'inventory', title: 'i', icon: 'Box', children: [item('status', '/inventory/status')] },
];

describe('menu filtering', () => {
  it('hides items the caller cannot open and parents left without visible children', () => {
    const order = menus[1].children;
    expect(filterMenuItems(order, held())).toEqual([]);
    expect(filterMenuItems(order, held('order.order.read'))[0].children?.map((c) => c.id)).toEqual(['history', 'soon']);
  });

  it('hides a main menu that has only coming-soon items left', () => {
    const lonely = [item('group', undefined, [item('soon', undefined, undefined, true)])];
    expect(filterMenuItems(lonely, held('order.order.read'))).toEqual([]);
  });

  it('keeps a coming-soon-only group when the main menu has something to open (today admin sees it)', () => {
    const company = [
      item('user-management', undefined, [item('mine', '/company/my-account')]),
      item('management-support', undefined, [item('docs', undefined, undefined, true)]),
    ];
    expect(filterMenuItems(company, held()).map((i) => i.id)).toEqual(['user-management', 'management-support']);
  });
});

describe('first accessible path', () => {
  it('skips sign-in-only screens and picks the first permitted menu', () => {
    expect(firstAccessiblePath(menus, held('inventory.stock.read'))).toBe('/inventory/status');
  });

  it('returns null when nothing is permitted', () => {
    expect(firstAccessiblePath(menus, held())).toBeNull();
  });

  it('finds the first permitted screen inside one main menu', () => {
    expect(firstAccessiblePathIn(menus[0], held('iam.role.read'))).toBe('/users');
    expect(firstAccessiblePathIn(menus[0], held())).toBe('/company/my-account');
  });
});

describe('permission labels', () => {
  it('shows the catalog label and keeps unknown keys as they are', () => {
    expect(permissionLabel('order.order.read')).toBe('주문 조회');
    expect(permissionLabel('x.y.z')).toBe('x.y.z');
  });

  it('reads required permissions only from a well-formed body', () => {
    expect(readRequiredPermissions({ message: 'Permission required', requiredPermissions: ['order.order.write'] })).toEqual(['order.order.write']);
    expect(readRequiredPermissions({ message: 'Forbidden resource' })).toEqual([]);
    expect(readRequiredPermissions({ requiredPermissions: 'order.order.write' })).toEqual([]);
    expect(readRequiredPermissions(null)).toEqual([]);
  });
});
