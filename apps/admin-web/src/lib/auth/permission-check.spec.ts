import { blockedReason, checkCan, permissionDeniedMessage, openState, permissionCheckFrom, runState, shouldRefreshPermissionsAfter403, showTrigger } from './permission-check';

const data = { roles: [], permissions: new Set(['order.order.read']), version: 'v1', landingPath: null };

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

describe('write triggers', () => {
  const cancel = { permission: ['order.order.cancel'] as const };
  const read = { permission: ['order.order.read'] as const };

  it('hides a write trigger until the permissions are confirmed, and when the lookup failed', () => {
    expect(showTrigger(runState({ isPending: true, isError: false }, [cancel]))).toBe(false);
    expect(showTrigger(runState({ isPending: false, isError: true }, [cancel]))).toBe(false);
  });

  it('treats a failed refresh as unknown even when an older copy is still cached', () => {
    const writer = { roles: [], permissions: new Set(['order.order.cancel']), version: 'v1', landingPath: null };
    const stale = { isPending: false, isError: true, data: writer };
    expect(showTrigger(runState(stale, [cancel]))).toBe(false);
    expect(blockedReason(runState(stale, [cancel]), [cancel])).toBe('권한 정보를 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.');
    expect(permissionCheckFrom(stale).canRun(cancel)).toBe(false);
    expect(showTrigger(openState(stale, '/order/history'))).toBe(false);
    expect(permissionCheckFrom(stale).can(['order.order.cancel'])).toBe(false);
    // 닫는 이유는 «확인 못 함»이다 — 화면이 «권한 없음»으로 말하지 않게 미확인 상태로 알린다
    expect(permissionCheckFrom(stale).isPermissionLoading).toBe(true);
  });

  it('answers from the loaded permissions and needs every action', () => {
    expect(showTrigger(runState({ isPending: false, isError: false, data }, [cancel]))).toBe(false);
    expect(showTrigger(runState({ isPending: false, isError: false, data }, [read]))).toBe(true);
    expect(showTrigger(runState({ isPending: false, isError: false, data }, [read, cancel]))).toBe(false);
  });

  it('blocks a value control until confirmed, saying why without calling it a missing permission', () => {
    expect(blockedReason(runState({ isPending: true, isError: false }, [cancel]), [cancel])).toBe('권한을 확인하는 중입니다.');
    expect(blockedReason(runState({ isPending: false, isError: true }, [cancel]), [cancel])).toBe(
      '권한 정보를 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.',
    );
    expect(blockedReason(runState({ isPending: false, isError: false, data }, [cancel]), [cancel])).toBe(
      '이 작업에는 주문 취소 권한이 필요합니다.',
    );
    expect(blockedReason(runState({ isPending: false, isError: false, data }, [read]), [read])).toBeNull();
  });

  it('gives the screen-wide checker the same answers', () => {
    const check = permissionCheckFrom({ isPending: false, isError: false, data });
    expect(check.canRun(read)).toBe(true);
    expect(check.canRun(cancel)).toBe(false);
    expect(check.blockedReason(cancel)).toBe('이 작업에는 주문 취소 권한이 필요합니다.');
    expect(permissionCheckFrom({ isPending: false, isError: true }).canRun(cancel)).toBe(false);
  });
});

describe('links to another screen', () => {
  it('shows a link only when the target screen would let the user in', () => {
    const writer = { roles: [], permissions: new Set(['catalog.product.write']), version: 'v1', landingPath: null };
    expect(showTrigger(openState({ isPending: false, isError: false, data: writer }, '/mall/product-registration'))).toBe(true);
    expect(showTrigger(openState({ isPending: false, isError: false, data }, '/mall/product-registration'))).toBe(false);
    expect(showTrigger(openState({ isPending: true, isError: false }, '/mall/product-registration'))).toBe(false);
  });

  it('refuses a screen the access table does not know', () => {
    expect(() => openState({ isPending: false, isError: false, data }, '/no-such-screen')).toThrow('/no-such-screen');
  });
});
