# 다중 RP SSO 도입 시 차단/심각 이슈

> 본 문서는 `apps/user-service`(IdP)와 `web/auth-web`(계정 허브) 조합을
> **여러 React/Next.js 앱(RP)**에 SSO로 붙이는 시나리오를 가정했을 때
> "그대로 두면 막힌다"고 판단되는 문제만 정리한다.
> 표면적/스타일 이슈(컨트롤러 try-catch 매핑, claim shape 비표준 등)는 제외.

심각도는 다음 기준이다.

- **Blocker** — 이 상태로는 시나리오 자체가 성립하지 않음. 우회도 불안전.
- **High** — 동작은 하지만 보안/운영상 큰 부채. RP 수가 늘면 빠르게 곪음.

---

## 1. (Blocker) Access token이 HS256 + 공유 `AUTH_SECRET`로 서명됨

**위치**: `src/api/oauth/oauth.manager.ts:172-178` (`mintTokenPair`)

```ts
const accessToken = await this.jwtService.signAsync(
  { sub: userId, client_id: clientId, scope },
  { secret: this.configService.getOrThrow<string>('AUTH_SECRET'), expiresIn: ... },
);
```

OAuth가 발급하는 access token이 user-service **내부** access token과 동일한
대칭키(`AUTH_SECRET`)로 서명된다.

### 무엇이 문제인가
- RP가 토큰을 자체 검증(JWT verify)하려면 이 시크릿을 공유해야 한다.
- 그 시점에 **RP는 임의의 `sub`로 access token을 위조할 수 있다.**
  즉 한 RP가 침해되면 IdP 전체가 침해된 것과 동치다.
- 결과적으로 RP는 "토큰 자체 검증"을 포기하고 매 요청마다
  `/oauth/userinfo`를 호출하는 패턴으로 강제된다 → 지연 + IdP 부하 + 캐시 정책 부담.

### 방향
- 비대칭 서명(RS256/EdDSA)으로 전환.
- key rotation을 전제로 한 JWKS endpoint(`/.well-known/jwks.json`) 노출.
- 내부용 access token과 OAuth용 access token의 **시크릿을 분리**(같은 알고리즘이라도).

---

## 2. (Blocker) OIDC discovery / JWKS 엔드포인트 부재

**위치**: 없음 (`grep -r "well-known\|jwks" apps/user-service/src` 결과 0건)

`/.well-known/openid-configuration`, `/.well-known/jwks.json`이 없다.

### 무엇이 문제인가
- `next-auth`, `openid-client`, `passport-openidconnect`,
  iOS/Android의 AppAuth 등 **표준 OIDC 클라이언트 라이브러리로 붙일 수 없다.**
- RP마다 PKCE 파라미터 생성, state/nonce 관리, token 교환,
  userinfo 호출, refresh rotation 처리를 손으로 구현해야 한다.
  — RP가 N개로 늘어나면 보일러플레이트와 버그 표면적도 N배.

### 방향
- discovery 문서를 정적으로라도 노출(issuer, authorization_endpoint,
  token_endpoint, userinfo_endpoint, jwks_uri, end_session_endpoint, …).
- 1번과 묶어서 진행해야 의미가 있다(JWKS는 비대칭키가 전제).

---

## 3. (Blocker) `/oauth/authorize`가 실제 authorize endpoint가 아님

**위치**: `web/auth-web/app/oauth/authorize/page.tsx:11-32`

```ts
const back = `${env.selfOrigin}${buildAuthorizeUrl(params)}`;
const huburl = `/?redirect_to=${encodeURIComponent(back)}`;
redirect(huburl);
```

들어오면 무조건 계정 허브(`/?redirect_to=...`)로 리다이렉트한다.

### 무엇이 문제인가
- **silent SSO 없음**: 이미 활성 세션을 가진 사용자도
  RP에 들어갈 때마다 계정 선택 화면을 본다.
  단일 활성 계정이면 자동으로 code를 발급해 `redirect_uri`로 보내는
  분기(`prompt=none` 의미)가 필요하다.
- **consent screen 없음**: first-party 한정 모델. third-party 앱에 SSO를 열어줄
  여지가 없다(범위 동의/철회 UX 자체가 없음).
- **prompt 파라미터 무시**: `prompt=login`, `prompt=none` 같은 OIDC 표준 동작 부재.

### 방향
- `/oauth/authorize` 진입 시 활성 세션 조회 → 단일 계정이면
  바로 `issueOAuthCodeInternal` 호출 후 `redirect_uri`로 302.
- 다중 계정/`prompt=select_account`일 때만 허브로.
- 미인증이면 `signin` 후 다시 authorize로 복귀.

---

## 4. (Blocker) Public client(SPA)는 RP가 될 수 없음

**위치**: `src/api/oauth/oauth.manager.ts:91, 102-111`

```ts
async issueToken(input: TokenRequestDto) {
  await this.assertClientCredentials(input.clientId, input.clientSecret); // 항상 필수
  ...
}
```

토큰 엔드포인트가 모든 grant에서 `client_secret`을 강제한다.

### 무엇이 문제인가
- 브라우저/모바일 SPA는 secret을 안전하게 보관할 수 없다 → **PKCE만으로
  인증되는 public client 분기가 표준**(RFC 8252 / OAuth 2.1)인데 없음.
- 결과적으로 **모든 RP가 server-side(BFF)를 가져야** 한다.
  순수 React SPA, RN, 정적 호스팅 앱은 그대로 못 붙인다.

### 방향
- `oauth_clients` 테이블에 `clientType: 'confidential' | 'public'` 추가.
- public client는 `client_secret` 없이 PKCE 검증만으로 통과.
- 동시에 redirect_uri 검증을 더 엄격하게(loopback/custom scheme 처리).

---

## 5. (High) Single Logout(SLO) 없음

**위치**: 없음. `end_session_endpoint`/back-channel logout 미구현.
`src/api/auth/auth.controller.ts:104-110`(signOut)은 user-service 내부 토큰만 정리.

### 무엇이 문제인가
- 한 RP에서 로그아웃해도 **그 사용자에게 발급된 OAuth refresh token들
  (`oauth_tokens`)은 살아있다** → 다른 RP는 그대로 access token을 갱신해 사용.
- "한 곳에서 로그아웃 = 모든 곳 로그아웃"이라는 SSO 사용자 기대와 어긋남.
- 보안 사고 시 사용자 단위 일괄 강제 로그아웃 수단도 부재.

### 방향
- `end_session_endpoint` 추가: 사용자 ID(또는 id_token_hint)로
  해당 사용자의 모든 `oauth_tokens.isRevoked = true`.
- 선택적으로 RP에 back-channel logout webhook(`logout_token` JWT) 발송.
- parent cookie도 동시에 expire.

---

## 6. (High) parent-cookie SSO와 OAuth flow의 이중 신뢰 모델

**위치**: `web/auth-web/lib/parent-cookies.ts`, `web/auth-web/app/actions.ts:promoteTokens`

`promoteTokens`는 OAuth code를 발급한 직후에도 항상 parent 도메인
(`PARENT_COOKIE_DOMAIN`)에 `accessToken`/`refreshToken`을 그대로 심는다.

### 무엇이 문제인가
- 같은 부모 도메인의 RP는 **OAuth 토큰과 parent cookie 두 종류**를 동시에 갖게 된다.
  RP가 어느 쪽을 신뢰해야 하는지의 룰이 명문화되어 있지 않음.
- parent cookie의 access token은 **user-service 내부 토큰과 동일 시크릿**(1번 이슈와 직결).
  RP가 이 쿠키만 보고 인증을 끝내면 1번의 위조 위험이 그대로 RP까지 전파됨.
- 다른 루트 도메인 / 모바일 / cross-origin RP는 OAuth flow만 가능 →
  RP 종류에 따라 인증 모델이 두 가지로 분기, 운영 복잡도 증가.
- access token TTL 15분 만료 시 누가 갱신을 트리거하는지(쿠키 기반? OAuth refresh?)
  계약이 모호.

### 방향
- 장기적으로는 **parent cookie 기반 SSO를 폐기**하고 OAuth flow로 단일화.
  (first-party 앱도 RP로 취급)
- 폐기 전이라도, parent cookie로 인증된 요청과 OAuth bearer 인증 요청을
  서버단에서 **명확히 구분된 토큰 종류**로 받도록 access token 시크릿/issuer/audience를 분리.

---

## 우선순위 제안

1, 2, 6은 한 묶음으로 보는 게 자연스럽다.
1번(비대칭 서명) → 2번(JWKS/discovery) → 6번(parent cookie 신뢰 경계 정리) 순으로
풀면, 그 위에서 3·4·5가 비교적 작업량이 적어진다.

| 단계 | 작업 | 해소 이슈 |
|------|------|-----------|
| 1 | RS256 전환, OAuth용 시크릿/issuer 분리 | #1 |
| 2 | `/.well-known/jwks.json`, `/.well-known/openid-configuration` | #2 |
| 3 | parent cookie와 OAuth bearer의 audience/issuer 분리, RP 가이드 | #6 |
| 4 | `/oauth/authorize`에 silent SSO + prompt 처리 | #3 |
| 5 | public client 분기(`client_secret` 옵셔널 + PKCE 강제) | #4 |
| 6 | `end_session_endpoint` + 사용자 단위 OAuth 토큰 일괄 revoke | #5 |
