export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  idToken?: string;
  /** epoch ms when the access token expires */
  expiresAt: number;
}

export interface TokenStore {
  load(): Promise<TokenSet | null>;
  save(t: TokenSet): Promise<void>;
  clear(): Promise<void>;
}

// --- Real store: wraps @tauri-apps/plugin-stronghold. Not unit-tested here
// (requires a Tauri runtime) — correctness is verified by `npm run build`
// (type-check) and, later, manual exercise on the dev box.
//
// Deviation from the brief: the installed plugin-stronghold@2.3.1 `Client`
// class has no `store` field (only `getStore(): Store`), so the brief's
// `Client['store']` indexed-access type does not exist and fails to
// type-check. Import `Store` directly instead.
import { Stronghold, Client, Store } from '@tauri-apps/plugin-stronghold';
import { appDataDir, join } from '@tauri-apps/api/path';

const VAULT = 'almondwms.hold';
const CLIENT = 'auth';
const KEY = 'tokenSet';

export function createStrongholdTokenStore(): TokenStore {
  let cached: Stronghold | null = null;
  async function hold(): Promise<{ store: Store; sh: Stronghold }> {
    if (!cached) {
      const path = await join(await appDataDir(), VAULT);
      cached = await Stronghold.load(path, 'almondwms'); // vault password
    }
    let client: Client;
    try {
      client = await cached.loadClient(CLIENT);
    } catch {
      client = await cached.createClient(CLIENT);
    }
    return { store: client.getStore(), sh: cached };
  }
  return {
    async load() {
      const { store } = await hold();
      const bytes = await store.get(KEY);
      if (!bytes) return null;
      return JSON.parse(new TextDecoder().decode(bytes)) as TokenSet;
    },
    async save(t) {
      const { store, sh } = await hold();
      await store.insert(
        KEY,
        Array.from(new TextEncoder().encode(JSON.stringify(t)))
      );
      await sh.save();
    },
    async clear() {
      const { store, sh } = await hold();
      await store.remove(KEY);
      await sh.save();
    },
  };
}
