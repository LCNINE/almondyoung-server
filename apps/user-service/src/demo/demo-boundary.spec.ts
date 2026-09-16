import { isDemoBlockedAuthPath, validateDemoAuthEnvironment } from './demo-boundary';

describe('demo authentication boundary', () => {
  it.each([
    '/cafe24/member-info',
    '/auth/kakao/signin',
    '/auth/link/naver/callback',
    '/auth/signup',
    '/auth/signup/cafe24/bootstrap',
  ])('blocks external identity entrypoint %s', (path) => expect(isDemoBlockedAuthPath(path)).toBe(true));
  it.each(['/auth/signin', '/oauth/token', '/.well-known/jwks.json', '/users/me', '/auth/change-password'])(
    'preserves normal authentication %s',
    (path) => expect(isDemoBlockedAuthPath(path)).toBe(false),
  );
  it('rejects real integration mode or external credentials in demo', () => {
    expect(() => validateDemoAuthEnvironment({ APP_STAGE: 'demo' })).toThrow();
    expect(() =>
      validateDemoAuthEnvironment({
        APP_STAGE: 'demo',
        EXTERNAL_INTEGRATIONS_MODE: 'mock',
        CAFE24_CLIENT_SECRET: 'accidental',
      }),
    ).toThrow();
    expect(() => validateDemoAuthEnvironment({ APP_STAGE: 'live', CAFE24_CLIENT_SECRET: 'existing' })).not.toThrow();
  });
});
