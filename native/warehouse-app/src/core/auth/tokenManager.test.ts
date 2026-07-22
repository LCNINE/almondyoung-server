import { describe, it, expect, vi } from 'vitest';
import { createTokenManager } from './tokenManager';
import type { TokenSet, TokenStore } from './tokenStore';

function memoryStore(initial: TokenSet | null): TokenStore {
  let t = initial;
  return {
    load: async () => t,
    save: async (n) => {
      t = n;
    },
    clear: async () => {
      t = null;
    },
  };
}

const valid: TokenSet = {
  accessToken: 'A',
  refreshToken: 'R',
  expiresAt: 120_000,
};
const expired: TokenSet = { ...valid, accessToken: 'OLD', expiresAt: 70_000 };

describe('createTokenManager', () => {
  it('returns the current access token when still valid', async () => {
    const refresh = vi.fn();
    const m = createTokenManager({
      store: memoryStore(valid),
      refresh,
      now: () => 60_000,
    });
    expect(await m.getAccessToken()).toBe('A');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('refreshes when expired and persists the new set', async () => {
    const store = memoryStore(expired);
    const refresh = vi.fn(async (): Promise<TokenSet> => ({
      accessToken: 'NEW',
      refreshToken: 'R2',
      expiresAt: 20_000,
    }));
    const m = createTokenManager({ store, refresh, now: () => 60_000 });
    expect(await m.getAccessToken()).toBe('NEW');
    expect(refresh).toHaveBeenCalledWith('R');
    expect((await store.load())?.refreshToken).toBe('R2');
  });

  it('single-flights concurrent refreshes into one call', async () => {
    let resolve!: (t: TokenSet) => void;
    const refresh = vi.fn(() => new Promise<TokenSet>((r) => (resolve = r)));
    const m = createTokenManager({
      store: memoryStore(expired),
      refresh,
      now: () => 60_000,
    });
    const p1 = m.getAccessToken();
    const p2 = m.getAccessToken();
    // Let the pending `await store.load()` microtask in both getAccessToken()
    // calls run so `refresh()` (and thus `resolve`) is actually assigned
    // before we call it — otherwise `resolve` is still undefined here since
    // memoryStore.load() is itself async.
    await Promise.resolve();
    resolve({ accessToken: 'NEW', refreshToken: 'R2', expiresAt: 20_000 });
    expect(await p1).toBe('NEW');
    expect(await p2).toBe('NEW');
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
