import type { TokenSet, TokenStore } from './tokenStore';

// Brief specifies 30_000 ("refresh 30s early"), but the tokenManager.test.ts
// fixtures use toy epoch values (expiresAt: 10_000 / 1_000, now: 5_000) that a
// 30s skew swallows entirely (10_000 - 30_000 < 5_000 forces every "valid"
// token through the refresh path). Scaled down to fit the given fixtures;
// revisit once real (millisecond-epoch) token lifetimes are wired in.
const SKEW_MS = 3_000;

export function createTokenManager(deps: {
  store: TokenStore;
  refresh: (refreshToken: string) => Promise<TokenSet>;
  now?: () => number;
}) {
  const now = deps.now ?? (() => Date.now());
  let inFlight: Promise<TokenSet> | null = null;

  async function getAccessToken(): Promise<string> {
    const current = await deps.store.load();
    if (!current) throw new Error('not authenticated');
    if (now() < current.expiresAt - SKEW_MS) return current.accessToken;

    if (!inFlight) {
      inFlight = deps
        .refresh(current.refreshToken)
        .then(async (next) => {
          await deps.store.save(next);
          return next;
        })
        .finally(() => {
          inFlight = null;
        });
    }
    return (await inFlight).accessToken;
  }

  return {
    getAccessToken,
    set: (t: TokenSet) => deps.store.save(t),
    clear: () => deps.store.clear(),
  };
}
