/**
 * `npm run generate:token` 이 발급한 토큰이 **core 에 실제로 들어가는지**를 고정한다.
 *
 * 이 스크립트는 HS256 legacy 토큰을 만드는데 페이로드에 `iss` 를 박고 있었다. 그런데
 * `libs/authorization` 의 `JwtAccessStrategy.validate()` 는 *iss 가 있을 때만* issuer 를
 * 검증한다 — 그 분기는 RS256 OIDC 토큰을 위한 것이다(같은 파일 주석: "legacy HS256
 * 토큰은 iss/aud claim 자체가 없으므로"). 로컬 core 의 `OIDC_ISSUER_URL` 은
 * `https://user.almondyoung.com` 이라, 이 스크립트가 무슨 iss 를 넣든 401 이 났다.
 *
 * 즉 저장소에 있는 유일한 토큰 발급 도구가 저장소의 주 API 서버에 못 들어갔다
 * (2026-08-26 dev 스모크에서 발견).
 */
// 대상이 `.ts` 가 아니라 `.js` 다 — `npm run generate:token` 이 ts-node 없이 `node` 로
// 직접 부르는 스크립트라 그대로 둔다. 그래서 import 가 아니라 require 로 가져온다.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { buildTokenPayload } = require('./generate-jwt-token') as {
  buildTokenPayload: (input: { userId: string; email: string; roles: string[] }) => Record<string, unknown>;
};

const INPUT = { userId: '00000000-0000-4000-8000-000000000001', email: 'dev@example.com', roles: ['admin'] };

describe('generate-jwt-token 페이로드', () => {
  it('iss 를 싣지 않는다 — 실으면 HS256 토큰이 OIDC issuer 검증에 걸린다', () => {
    expect(buildTokenPayload(INPUT)).not.toHaveProperty('iss');
  });

  it('aud 도 싣지 않는다 — 같은 분기가 audience 까지 본다', () => {
    expect(buildTokenPayload(INPUT)).not.toHaveProperty('aud');
  });

  it('core 가 사용자를 식별하는 claim 은 그대로 싣는다', () => {
    expect(buildTokenPayload(INPUT)).toEqual({
      sub: INPUT.userId,
      userId: INPUT.userId,
      email: INPUT.email,
      roles: INPUT.roles,
    });
  });
});
