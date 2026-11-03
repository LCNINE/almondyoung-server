jest.mock('server-only', () => ({}), { virtual: true });
jest.mock('../../web/auth-web/lib/env', () => ({
  env: { userServiceUrl: 'http://user-service.test', oauthInternalSecret: 'secret' },
}));

import { signIn } from '../../web/auth-web/lib/user-service';

/**
 * auth-web 의 로그인 호출이 화면의 테넌트를 user-service 에 넘기는가 — 넘기지 않으면 user-service 는 모든 테넌트에서 계정을
 * 찾고, 다른 테넌트 계정의 로그인이 비밀번호까지 통과한 뒤 코드 발급에서야 막힌다(계정이 있다는 게 드러난다).
 */
describe('auth-web → user-service 로그인 요청', () => {
  const fetchMock = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>();
  const realFetch = global.fetch;

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: { accessToken: 'a', refreshToken: 'r' } }), { status: 200 }),
    );
    global.fetch = fetchMock;
  });
  afterAll(() => {
    global.fetch = realFetch;
  });

  it('보증 헤더(테넌트 + 내부 비밀)를 싣고, 본문에는 테넌트를 넣지 않는다(옛 user-service 는 모르는 본문 필드를 400)', async () => {
    const tokens = await signIn(
      { loginId: 'staff', password: 'pw', rememberMe: false },
      { 'x-tenant-id': '2', 'x-internal-secret': 'secret' },
    );

    expect(tokens).toEqual({ accessToken: 'a', refreshToken: 'r' });
    const [url, init = {}] = fetchMock.mock.calls[0];
    expect(url).toBe('http://user-service.test/auth/signin');
    expect(init.headers).toEqual({
      'content-type': 'application/json',
      'x-tenant-id': '2',
      'x-internal-secret': 'secret',
    });
    expect(JSON.parse(String(init.body))).toEqual({ loginId: 'staff', password: 'pw', rememberMe: false });
  });
});
