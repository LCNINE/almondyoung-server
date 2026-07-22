import { describe, it, expect } from 'vitest';
import { isRedirect } from '@tanstack/react-router';
import { requireAuth, requireAnon } from './guards';

const stub = (v: boolean) => ({ isAuthenticated: () => v });

describe('requireAuth', () => {
  it('redirects to /login when unauthenticated', () => {
    try {
      requireAuth(stub(false));
      throw new Error('did not throw');
    } catch (e) {
      expect(isRedirect(e)).toBe(true);
      if (isRedirect(e)) expect(e.options.to).toBe('/login');
    }
  });

  it('does not throw when authenticated', () => {
    expect(() => requireAuth(stub(true))).not.toThrow();
  });
});

describe('requireAnon', () => {
  it('redirects to / when authenticated', () => {
    try {
      requireAnon(stub(true));
      throw new Error('did not throw');
    } catch (e) {
      expect(isRedirect(e)).toBe(true);
      if (isRedirect(e)) expect(e.options.to).toBe('/');
    }
  });

  it('does not throw when unauthenticated', () => {
    expect(() => requireAnon(stub(false))).not.toThrow();
  });
});
