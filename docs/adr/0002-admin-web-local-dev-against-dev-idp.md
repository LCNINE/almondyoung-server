# admin-web 로컬 개발은 dev IdP 의 동일 client 에 loopback redirect 를 추가해서 진행한다

admin-web 은 변경 빈도가 높지만 통합 검증을 위해 항상 dev stage 배포가 필요했다. 백엔드가 dev 에 떠 있는 동안 admin-web 만 로컬에서 띄워서 즉시 반영을 보고 싶다는 요구가 생겼고, OIDC RP 구성상 IdP 가 redirect_uri 화이트리스트 정확 일치를 요구하므로(`apps/user-service/src/api/oauth/redirect-uri.ts`) 로컬 셋업이 자명하지 않다.

결정: dev `user-service` 의 `oauth_clients.admin-web` 레코드에 `http://localhost:3000/auth/callback` 과 `http://localhost:3000/login` 두 loopback URI 를 각각 `redirect_uris` / `post_logout_redirect_uris` 에 append 한다. client_id/secret 은 dev 와 공유하며, 개발자는 dev `OIDC_CLIENT_SECRET` 을 팀 vault 에서 가져와 `.env.local` 에 넣고 `npm run start:admin-web:dev` 로 실행한다.

## Considered Options

- **로컬 전용 신규 client (`admin-web-local`) 발급** — 시크릿 격리는 깔끔하나 IdP 레코드와 auth-web 의 client 선택 UI 가 늘어나는 운영 부담. 로컬 셋업은 일시적/개인적이라 client 신규 발급 대비 가치 낮음.
- **admin-web client 를 public 으로 전환해 RFC 8252 loopback any-port 매칭 허용** — 포트가 자유로워지지만 client_secret 강제가 풀린다. admin-web 은 server-side RP 라 confidential 이 보안 모델상 맞고, 고정 포트(3000) 합의로 충분.
- **로컬에서 BYPASS_AUTH 같은 비-OIDC 우회** — OIDC 흐름 자체의 회귀(콜백/로그아웃/리프레시) 가 안 잡혀서 dev 배포에서만 발견되는 버그가 늘어남.

## Consequences

- **IdP 세션은 공유된다.** 같은 사용자가 로컬 admin-web 과 dev 배포 admin-web 에 동시 로그인한 상태에서 한 쪽에서 로그아웃하면 IdP(`auth.dev.lcnine-dev.com`) 의 세션이 종료되어 반대쪽도 access token 만료 후 재로그인이 강제된다.
- **Refresh rotation reuse-detection 이 로컬에서 더 자주 트리거된다.** Next dev mode 의 동시 server action / 빠른 reload 가 같은 refresh_token 으로 `/oauth/token` 을 동시에 두 번 호출하면 user-service 가 chain 을 revoke 해서 모든 호출이 401 이 된다. "갑자기 로그아웃" 증상의 첫 번째 의심 항목.
- **포트는 3000 고정.** 다른 포트를 쓰려면 IdP 레코드에 해당 URI 를 추가 등록해야 한다.
