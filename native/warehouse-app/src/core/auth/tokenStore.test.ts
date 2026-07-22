import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the Tauri stronghold plugin + path API so the store's concurrency logic
// can be unit-tested without a Tauri runtime. `Stronghold.load` maps 1:1 to the
// plugin's `initialize` command, which REPLACES the per-path Stronghold in the
// plugin's collection — so calling it twice for one vault path discards a
// loaded client and makes later get/insert/save throw ClientDataNotPresent.
const h = vi.hoisted(() => {
  const storeRecord = {
    get: vi.fn(async () => null),
    insert: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
  };
  const client = { getStore: () => storeRecord };
  const stronghold = {
    loadClient: vi.fn(async () => client),
    createClient: vi.fn(async () => client),
    save: vi.fn(async () => {}),
  };
  const load = vi.fn(async () => stronghold);
  return { storeRecord, client, stronghold, load };
});

vi.mock('@tauri-apps/plugin-stronghold', () => ({
  Stronghold: { load: h.load },
  Client: class {},
  Store: class {},
}));
vi.mock('@tauri-apps/api/path', () => ({
  appDataDir: vi.fn(async () => '/data'),
  join: vi.fn(async (...parts: string[]) => parts.join('/')),
}));

import { createStrongholdTokenStore } from './tokenStore';

beforeEach(() => {
  h.load.mockClear();
  h.stronghold.loadClient.mockClear();
  h.stronghold.createClient.mockClear();
});

describe('createStrongholdTokenStore concurrency', () => {
  it('opens the vault exactly once under concurrent access (StrictMode double-bootstrap safe)', async () => {
    const store = createStrongholdTokenStore();

    // Two concurrent operations, mimicking React StrictMode double-invoking
    // Bootstrap → two session.bootstrap() → two store.load() → two hold().
    await Promise.all([store.load(), store.load()]);

    // Without single-flight, hold() runs Stronghold.load (plugin `initialize`,
    // which replaces the collection's Stronghold) twice and loses the loaded
    // client — the on-device "error loading client data; no data present".
    expect(h.load).toHaveBeenCalledTimes(1);
    expect(h.stronghold.loadClient).toHaveBeenCalledTimes(1);
  });

  it('reuses the same open vault across a load then a later save', async () => {
    const store = createStrongholdTokenStore();
    await store.load();
    await store.save({
      accessToken: 'A',
      refreshToken: 'R',
      expiresAt: 1,
    });
    expect(h.load).toHaveBeenCalledTimes(1);
    expect(h.stronghold.save).toHaveBeenCalledTimes(1);
  });
});
