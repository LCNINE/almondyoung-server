import { describe, expect, it } from 'vitest';
import { validateDemoConfig } from './demo-config';

describe('demo build endpoints', () => {
  it('rejects a demo binary pointed at a live endpoint', () => {
    expect(() =>
      validateDemoConfig({
        stage: 'demo',
        apiUrl: 'https://core.almondyoung.com',
        issuer: 'https://user.almondyoung-next.com',
        authorize: 'https://auth.almondyoung-next.com/oauth/authorize',
      })
    ).toThrow();
  });
  it('allows the isolated demo endpoint set and leaves existing non-demo configurations unchanged', () => {
    expect(() =>
      validateDemoConfig({
        stage: 'demo',
        apiUrl: 'https://core.almondyoung-next.com',
        issuer: 'https://user.almondyoung-next.com',
        authorize: 'https://auth.almondyoung-next.com/oauth/authorize',
      })
    ).not.toThrow();
    expect(() =>
      validateDemoConfig({
        apiUrl: 'http://localhost:3100',
        issuer: '',
        authorize: '',
      })
    ).not.toThrow();
  });
});
