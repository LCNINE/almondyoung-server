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

// SECURITY — PLACEHOLDER, deferred hardening (see ledger/spec): this vault
// password is a source-visible literal, which defeats the encrypted vault. It
// MUST be replaced by a device-derived key (the Rust-side argon2 stronghold
// init, deferred to the dev box) before this persists real refresh tokens.
const VAULT_PASSWORD = 'almondwms';

export function createStrongholdTokenStore(
  onStep: (s: string) => void = () => {}
): TokenStore {
  let cached: Stronghold | null = null;
  let cachedClient: Client | null = null;
  let opening: Promise<{ store: Store; sh: Stronghold }> | null = null;
  async function hold(): Promise<{ store: Store; sh: Stronghold }> {
    if (cached && cachedClient) {
      return { store: cachedClient.getStore(), sh: cached };
    }
    // Single-flight the vault open + client load. Concurrent callers MUST share
    // ONE Stronghold.load: the plugin's `initialize` command REPLACES the
    // per-path Stronghold in its collection, so a second concurrent open (e.g.
    // React StrictMode double-invoking bootstrap, or a bootstrap load racing a
    // login save) discards the client this loadClient/createClient populated —
    // and the next get/insert/save then throws ClientDataNotPresent
    // ("error loading client data; no data present"). A bare `if (!cached)`
    // guard is not concurrency-safe because the check precedes the await.
    if (!opening) {
      opening = (async () => {
        if (!cached) {
          onStep('6a resolve path…');
          const path = await join(await appDataDir(), VAULT);
          onStep(`6b Stronghold.load (open vault ${path})…`);
          cached = await Stronghold.load(path, VAULT_PASSWORD); // vault password
        }
        // Load-or-create the client ONCE and reuse it. Re-calling loadClient on
        // an already-loaded Stronghold throws ("client already loaded"), and a
        // bare catch would then createClient a fresh EMPTY client — losing a
        // just-saved token on the next read (→ getAccessToken sees null →
        // "not authenticated").
        if (!cachedClient) {
          try {
            onStep('6c loadClient…');
            cachedClient = await cached.loadClient(CLIENT);
          } catch (e) {
            onStep(`6c createClient (loadClient: ${String(e)})…`);
            cachedClient = await cached.createClient(CLIENT);
          }
        }
        return { store: cachedClient.getStore(), sh: cached };
      })().finally(() => {
        // Clear the in-flight latch so a failed open (thrown above) can be
        // retried by the next call; a successful open is served by the fast
        // path at the top from now on.
        opening = null;
      });
    }
    return opening;
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
      onStep('6d insert…');
      await store.insert(
        KEY,
        Array.from(new TextEncoder().encode(JSON.stringify(t)))
      );
      onStep('6e snapshot save…');
      await sh.save();
      onStep('6f stronghold done');
    },
    async clear() {
      const { store, sh } = await hold();
      await store.remove(KEY);
      await sh.save();
    },
  };
}
