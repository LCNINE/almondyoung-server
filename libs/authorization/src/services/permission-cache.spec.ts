import { PermissionCache } from './permission-cache';
import { PermissionRuntimeOptions } from './permission-runtime.options';
import { RolePermissionSnapshot, RolePermissionSource, SnapshotFetch } from './role-permission-source';

class FakeSource extends RolePermissionSource {
  configured = true;
  calls: (string | null)[] = [];
  next: Array<SnapshotFetch | Error> = [];

  isConfigured(): boolean {
    return this.configured;
  }

  async fetch(knownVersion: string | null): Promise<SnapshotFetch> {
    this.calls.push(knownVersion);
    const result = this.next.shift() ?? { status: 'not_modified' };
    if (result instanceof Error) throw result;
    return result;
  }
}

const snapshot = (version: string, roles: Record<string, string[]>): SnapshotFetch => ({
  status: 'loaded',
  snapshot: { version, roles: new Map(Object.entries(roles)) } satisfies RolePermissionSnapshot,
});

const options: PermissionRuntimeOptions = {
  service: 'core',
  enforce: false,
  refreshIntervalMs: 30_000,
  retryBaseMs: 1_000,
  summaryIntervalMs: 300_000,
};

describe('PermissionCache', () => {
  let source: FakeSource;
  let cache: PermissionCache;

  beforeEach(() => {
    jest.useFakeTimers();
    source = new FakeSource();
    cache = new PermissionCache(source, options);
  });
  afterEach(() => {
    cache.onModuleDestroy();
    jest.useRealTimers();
  });

  it('answers null until the first snapshot arrives', () => {
    expect(cache.permissionsFor(['admin'])).toBeNull();
    expect(cache.status().state).toBe('cold');
  });

  it('unions permissions of every role the caller holds', async () => {
    source.next.push(snapshot('v1', { admin: ['a.b.read', 'a.b.write'], intern: ['a.b.read', 'c.d.read'] }));
    await cache.refresh();
    expect([...(cache.permissionsFor(['intern', 'admin']) ?? [])].sort()).toEqual([
      'a.b.read',
      'a.b.write',
      'c.d.read',
    ]);
    expect(cache.permissionsFor(['user'])).toEqual(new Set());
  });

  it('keeps role names that collide with object prototype keys', async () => {
    // 객체 리터럴의 `__proto__:` 는 엔트리가 아니라 프로토타입 설정이다 — Map 으로 직접 만든다.
    source.next.push({
      status: 'loaded',
      snapshot: {
        version: 'v1',
        roles: new Map<string, string[]>([
          ['constructor', ['a.b.read']],
          ['__proto__', ['c.d.read']],
          ['toString', []],
        ]),
      },
    });
    await cache.refresh();
    expect([...(cache.permissionsFor(['constructor']) ?? [])]).toEqual(['a.b.read']);
    expect([...(cache.permissionsFor(['__proto__']) ?? [])]).toEqual(['c.d.read']);
    expect(cache.permissionsFor(['toString'])).toEqual(new Set());
    expect(cache.permissionsFor(['hasOwnProperty'])).toEqual(new Set());
  });

  it('keeps role combinations apart even when a role name contains the separator', async () => {
    source.next.push(snapshot('v1', { a: ['order.order.write'], b: [], 'a\nb': [] }));
    await cache.refresh();
    expect(cache.permissionsFor(['a', 'b'])?.has('order.order.write')).toBe(true);
    expect(cache.permissionsFor(['a\nb'])?.has('order.order.write')).toBe(false);
  });

  describe('rolesHolding', () => {
    it('answers null before the first snapshot', () => {
      expect(cache.rolesHolding('a.b.read')).toBeNull();
    });

    it('lists only roles that hold the permission', async () => {
      source.next.push(snapshot('v1', { admin: ['a.b.read'], intern: [], constructor: ['a.b.read'] }));
      await cache.refresh();
      expect(cache.rolesHolding('a.b.read')).toEqual(['admin', 'constructor']);
      expect(cache.rolesHolding('c.d.read')).toEqual([]);
    });

    it('follows a new snapshot', async () => {
      source.next.push(snapshot('v1', { admin: ['a.b.read'], intern: [] }));
      await cache.refresh();
      source.next.push(snapshot('v2', { admin: ['a.b.read'], intern: ['a.b.read'] }));
      await cache.refresh();
      expect(cache.rolesHolding('a.b.read')).toEqual(['admin', 'intern']);
    });
  });

  it('sends the known version and keeps the copy on not-modified', async () => {
    source.next.push(snapshot('v1', { admin: ['a.b.read'] }));
    await cache.refresh();
    await cache.refresh();
    expect(source.calls).toEqual([null, 'v1']);
    expect(cache.status().version).toBe('v1');
  });

  it('replaces the copy and forgets cached role sets when the version changes', async () => {
    source.next.push(snapshot('v1', { admin: ['a.b.read'] }));
    await cache.refresh();
    expect(cache.permissionsFor(['admin'])?.has('a.b.write')).toBe(false);
    source.next.push(snapshot('v2', { admin: ['a.b.read', 'a.b.write'] }));
    await cache.refresh();
    expect(cache.permissionsFor(['admin'])?.has('a.b.write')).toBe(true);
  });

  it('keeps the last copy when a refresh fails', async () => {
    source.next.push(snapshot('v1', { admin: ['a.b.read'] }));
    await cache.refresh();
    source.next.push(new Error('down'));
    await cache.refresh();
    expect(cache.permissionsFor(['admin'])?.has('a.b.read')).toBe(true);
    expect(cache.status()).toMatchObject({ state: 'ready', consecutiveFailures: 1 });
  });

  it('retries quickly while cold and slows down once loaded', async () => {
    source.next.push(new Error('down'), new Error('down'), snapshot('v1', { admin: [] }));
    cache.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(0);
    expect(source.calls).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(2_000);
    await jest.advanceTimersByTimeAsync(1_000);
    expect(source.calls).toHaveLength(3);
    expect(cache.status().state).toBe('ready');
    await jest.advanceTimersByTimeAsync(29_000);
    expect(source.calls).toHaveLength(3);
    await jest.advanceTimersByTimeAsync(1_000);
    expect(source.calls).toHaveLength(4);
  });

  it('stays disabled without a configured source and never calls it', async () => {
    source.configured = false;
    cache.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(60_000);
    expect(source.calls).toEqual([]);
    expect(cache.status().state).toBe('disabled');
  });

  it('runs one fetch at a time', async () => {
    source.next.push(snapshot('v1', { admin: [] }));
    await Promise.all([cache.refresh(), cache.refresh()]);
    expect(source.calls).toHaveLength(1);
  });

  it('reports the age of the copy', async () => {
    jest.setSystemTime(1_000_000);
    source.next.push(snapshot('v1', { admin: [] }));
    await cache.refresh();
    expect(cache.status(1_045_000).ageMs).toBe(45_000);
  });
});
