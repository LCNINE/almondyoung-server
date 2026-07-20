import type { TokenSet, TokenStore } from './tokenStore';

const SKEW_MS = 30_000; // refresh 30s early

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
