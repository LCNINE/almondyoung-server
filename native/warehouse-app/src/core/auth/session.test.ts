import { describe, it, expect, vi } from 'vitest';
import { createSession, type Session } from './session';
import type { createTokenManager } from './tokenManager';

type Manager = ReturnType<typeof createTokenManager>;

function fakeManager(over: Partial<Manager> = {}): Manager {
  return {
    getAccessToken: async () => 'A',
    set: async () => {},
    clear: async () => {},
    ...over,
  } satisfies Manager;
}

function make(over: {
  manager?: Partial<Manager>;
  runLogin?: (m: Manager, onStep?: (s: string) => void) => Promise<void>;
} = {}): Session {
  return createSession({
    manager: fakeManager(over.manager),
    runLogin: over.runLogin ?? (async () => {}),
  });
}

describe('createSession', () => {
  it('starts unauthenticated', () => {
    expect(make().isAuthenticated()).toBe(false);
  });

  it('bootstrap → authenticated when a token is available', async () => {
    const s = make({ manager: { getAccessToken: async () => 'A' } });
    await s.bootstrap();
    expect(s.isAuthenticated()).toBe(true);
  });

  it('bootstrap → unauthenticated when getAccessToken throws', async () => {
    const s = make({
      manager: {
        getAccessToken: async () => {
          throw new Error('not authenticated');
        },
      },
    });
    await s.bootstrap();
    expect(s.isAuthenticated()).toBe(false);
  });

  it('login runs runLogin then flips authenticated and notifies subscribers', async () => {
    const runLogin = vi.fn(async () => {});
    const s = make({ runLogin });
    const listener = vi.fn();
    s.subscribe(listener);
    await s.login();
    expect(runLogin).toHaveBeenCalledOnce();
    expect(s.isAuthenticated()).toBe(true);
    expect(listener).toHaveBeenCalled();
  });

  it('logout clears the manager and flips unauthenticated', async () => {
    const clear = vi.fn(async () => {});
    const s = make({ manager: { clear } });
    await s.login();
    const listener = vi.fn();
    s.subscribe(listener);
    await s.logout();
    expect(clear).toHaveBeenCalledOnce();
    expect(s.isAuthenticated()).toBe(false);
    expect(listener).toHaveBeenCalled();
  });

  it('subscribe returns an unsubscribe that stops notifications', async () => {
    const s = make();
    const listener = vi.fn();
    const off = s.subscribe(listener);
    off();
    await s.login();
    expect(listener).not.toHaveBeenCalled();
  });
});
