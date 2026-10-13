import { MyPermissionsCache, parseMyPermissions, rolesKey, type MyPermissions } from './my-permissions';

const sample = (perms: string[]): MyPermissions => ({ roles: [{ name: 'admin', displayName: '관리자' }], permissions: new Set(perms), version: 'v1' });

describe('parseMyPermissions', () => {
  it('unwraps the response envelope and keeps the permission list as a set', () => {
    const parsed = parseMyPermissions({ success: true, data: { roles: [{ name: 'admin', displayName: '관리자' }], permissions: ['order.order.read'], version: 'v1' } });
    expect([...parsed.permissions]).toEqual(['order.order.read']);
    expect(parsed.roles).toEqual([{ name: 'admin', displayName: '관리자' }]);
  });

  it('accepts a body without the envelope', () => {
    expect(parseMyPermissions({ roles: [], permissions: [], version: 'v1' }).permissions.size).toBe(0);
  });

  it('rejects malformed bodies instead of treating them as no permissions', () => {
    expect(() => parseMyPermissions(null)).toThrow();
    expect(() => parseMyPermissions({ roles: [], permissions: 'order.order.read', version: 'v1' })).toThrow();
    expect(() => parseMyPermissions({ roles: [{ name: 1 }], permissions: [], version: 'v1' })).toThrow();
    expect(() => parseMyPermissions({ roles: [], permissions: [1], version: 'v1' })).toThrow();
  });
});

describe('rolesKey', () => {
  it('keys by the sorted role set', () => {
    expect(rolesKey(['master', 'admin', 'admin'])).toBe(rolesKey(['admin', 'master']));
    expect(rolesKey(['a,b'])).not.toBe(rolesKey(['a', 'b']));
    expect(rolesKey(['__proto__'])).not.toBe(rolesKey([]));
  });
});

describe('MyPermissionsCache', () => {
  let clock = 0;
  const now = () => clock;
  beforeEach(() => {
    clock = 0;
  });

  it('calls the source once per role set within the window', async () => {
    const fetcher = jest.fn(async () => sample(['order.order.read']));
    const cache = new MyPermissionsCache(fetcher, { now });
    await cache.get(['admin']);
    await cache.get(['admin']);
    await cache.get(['intern']);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('shares one call between concurrent requests', async () => {
    const fetcher = jest.fn(async () => sample([]));
    const cache = new MyPermissionsCache(fetcher, { now });
    await Promise.all([cache.get(['admin']), cache.get(['admin'])]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('asks again after the window', async () => {
    const fetcher = jest.fn(async () => sample([]));
    const cache = new MyPermissionsCache(fetcher, { now, ttlMs: 30_000 });
    await cache.get(['admin']);
    clock = 30_001;
    await cache.get(['admin']);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('keeps serving the last copy when a refresh fails', async () => {
    const fetcher = jest.fn().mockResolvedValueOnce(sample(['order.order.read'])).mockRejectedValueOnce(new Error('down'));
    const cache = new MyPermissionsCache(fetcher, { now });
    await cache.get(['admin']);
    clock = 60_000;
    expect([...((await cache.get(['admin']))?.permissions ?? [])]).toEqual(['order.order.read']);
  });

  it('reports unavailable when it never loaded', async () => {
    const cache = new MyPermissionsCache(async () => Promise.reject(new Error('down')), { now });
    expect(await cache.get(['admin'])).toBeNull();
  });

  it('forgets everything when the key limit is reached instead of growing without bound', async () => {
    const fetcher = jest.fn(async () => sample([]));
    const cache = new MyPermissionsCache(fetcher, { now, maxKeys: 2 });
    await cache.get(['a']);
    await cache.get(['b']);
    await cache.get(['c']);
    await cache.get(['a']);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it('waits before asking again after a failed refresh instead of calling the source on every request', async () => {
    const fetcher = jest.fn().mockResolvedValueOnce(sample(['order.order.read'])).mockRejectedValue(new Error('down'));
    const cache = new MyPermissionsCache(fetcher, { now, ttlMs: 30_000, retryMs: 5_000 });
    await cache.get(['admin']);
    clock = 30_001;
    for (let i = 0; i < 5; i += 1) expect([...((await cache.get(['admin']))?.permissions ?? [])]).toEqual(['order.order.read']);
    expect(fetcher).toHaveBeenCalledTimes(2);
    clock = 35_002;
    await cache.get(['admin']);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('does not hammer the source while it has never answered', async () => {
    const fetcher = jest.fn(async () => Promise.reject(new Error('down')));
    const cache = new MyPermissionsCache(fetcher, { now, retryMs: 5_000 });
    expect(await cache.get(['admin'])).toBeNull();
    expect(await cache.get(['admin'])).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
    clock = 5_001;
    await cache.get(['admin']);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
