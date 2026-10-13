import { checkCan, permissionDeniedMessage, shouldRefreshPermissionsAfter403, permissionCheckFrom } from './permission-check';

const data = { roles: [], permissions: new Set(['order.order.read']), version: 'v1' };

describe('checkCan', () => {
  it('does not turn loading or a failed load into a denial', () => {
    expect(checkCan({ isPending: true, isError: false }, ['order.order.read'])).toEqual({ status: 'loading' });
    expect(checkCan({ isPending: false, isError: true }, ['order.order.read'])).toEqual({ status: 'error' });
  });

  it('answers once the permissions are loaded', () => {
    expect(checkCan({ isPending: false, isError: false, data }, ['order.order.read'])).toEqual({ status: 'ready', allowed: true });
    expect(checkCan({ isPending: false, isError: false, data }, ['order.order.write'])).toEqual({ status: 'ready', allowed: false });
  });
});

describe('permissionDeniedMessage', () => {
  it('names the required permission when the server says which one', () => {
    expect(permissionDeniedMessage(['order.order.write'], 'Permission required')).toBe('이 작업에는 주문 입력·수정 권한이 필요합니다.');
  });

  it('keeps the server message when it does not', () => {
    expect(permissionDeniedMessage([], 'Forbidden resource')).toBe('Forbidden resource');
  });
});

describe('shouldRefreshPermissionsAfter403', () => {
  it('asks for a fresh permission copy after a denied request', () => {
    expect(shouldRefreshPermissionsAfter403('/proxy/api/sales-orders', 0, 100_000)).toBe(true);
  });

  it('never re-reads because the permission lookup itself was denied — that would loop', () => {
    expect(shouldRefreshPermissionsAfter403('/proxy/users/me/permissions', 0, 100_000)).toBe(false);
    expect(shouldRefreshPermissionsAfter403('http://localhost:3000/me/permissions?x=1', 0, 100_000)).toBe(false);
  });

  it('re-reads at most once in a short window when many requests are denied together', () => {
    expect(shouldRefreshPermissionsAfter403('/proxy/api/a', 99_000, 100_000)).toBe(false);
    expect(shouldRefreshPermissionsAfter403('/proxy/api/a', 80_000, 100_000)).toBe(true);
  });
});

describe('permissionCheckFrom', () => {
  it('keeps a failed lookup in the not-yet-known state so screens do not claim the permission is missing', () => {
    const check = permissionCheckFrom({ isPending: false, isError: true });
    expect(check.isPermissionLoading).toBe(true);
    expect(check.can(['order.order.read'])).toBe(false);
  });

  it('answers from the loaded permissions', () => {
    const check = permissionCheckFrom({ isPending: false, isError: false, data });
    expect(check.isPermissionLoading).toBe(false);
    expect(check.can(['order.order.read'])).toBe(true);
    expect(check.can(['order.order.write'])).toBe(false);
  });
});
