import { describe, it, expect } from 'vitest';
import { challengeFromVerifier, randomUrlSafe } from './pkce';

describe('PKCE', () => {
  it('matches the RFC 7636 Appendix B test vector', async () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const challenge = await challengeFromVerifier(verifier);
    expect(challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('randomUrlSafe produces url-safe strings of expected length', () => {
    const s = randomUrlSafe(32);
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(s.length).toBeGreaterThanOrEqual(43); // 32 bytes → 43 b64url chars
  });
});
