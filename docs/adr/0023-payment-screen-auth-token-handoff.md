# 결제창 인증 — 서브도메인 쿠키 의존 제거 (토큰 핸드오프)

결제창은 별도 서브도메인 `wallet-web` 에서 뜨고, 거기서 고객 로그인 세션을 **스스로 다시 확보**한 뒤 wallet-api 의 인증 엔드포인트(`/v1/payment-intents/:id/confirm` 등)를 호출한다. 세션 재확보는 (1) 부모 도메인 `.almondyoung-next.com` 에 박힌 쿠키를 wallet-web 서브도메인이 읽거나, (2) `/auth/ensure` 가 `wallet_rt`(14일 refresh) 로 토큰을 갱신하거나, 실패 시 (3) `/login` OIDC silent-SSO 왕복으로 이뤄진다.

이 구조는 **인앱브라우저(카카오톡·인스타·네이버)·iOS Safari(WebKit/ITP)** 에서 깨진다. 이들 환경은 서브도메인 간 쿠키 전송을 차단/격리하거나 다단계 redirect 중 IdP 세션 쿠키를 잃어버려, wallet-web 이 유효한 access token 을 끝내 확보하지 못한다. 그 결과:

- confirm 호출이 인증 없이 wallet-api 에 도달 → `JwtAuthGuard: "No auth token"` → **401**, 결제창이 다음 단계로 넘어가지 않음("결제창이 안 넘어가요").
- 같은 인증 경로를 쓰는 **배송지 저장(`POST /store/customers/me/addresses`)도 401** 로 함께 실패.
- intent 가 사용자에게 claim 되지 못해 `payment_intents.user_id` 가 NULL 로 남는다(읽기는 되고 쓰기만 막히는 특징).

라이브 로그상 confirm 401 이 한 고객에게서 28분간 반복됐고(새로고침/재진입에도 동일), 같은 유형의 미claim intent 가 누적되고 있었다. CloudFront·ALB 접속로그가 꺼져 있어 정확한 브라우저(User-Agent)는 사후 추출이 불가능했다.

## Decision

### 1. (적용) confirm/cancel/abandon 프록시에 refresh-on-401 + 관찰 로그

`apps/wallet-web/app/api/payment-intents/[intentId]/proxy.ts`:

- 1차 시도는 기존 동작(브라우저 쿠키 그대로 forwarding) 유지 — 현재 성공 경로에 영향 없음.
- **401 일 때만** `wallet_rt` 로 `refreshTokens()` 갱신 → **동일 `Idempotency-Key` 로 재시도** → 성공 시 회전된 세션 쿠키를 응답에 기록. 결제 페이지 체류 중 15분 access token 이 만료된 "시간초과형" 실패를 구제한다.
- 401 시 **User-Agent + refresh 성공여부**를 구조화 로그(`tag: pay-confirm-auth-401`)로 남겨, edge 로그 없이도 인앱브라우저 코호트를 식별한다(토큰은 로깅하지 않음).

한계: 쿠키 자체가 차단된 인앱브라우저는 여기서도 `wallet_rt` 가 없어 401 그대로다 — 아래 2번이 그 케이스를 해결한다.

### 2. (계획) 토큰 핸드오프로 서브도메인 쿠키 의존 제거

결제창이 세션을 "스스로 재확보"하는 의존을 없앤다. 스토어프론트는 결제 intent 를 만드는 시점에 이미 인증돼 있으므로, **거기서 단기·1회용 서명 핸드오프 토큰을 발급**해 URL 로 넘기고 wallet-web 이 서버에서 교환한다.

- **user-service(IdP)**: 인증 사용자에 대해 `aud=wallet-web`, **TTL ~120초, 1회용**(jti 소비) 핸드오프 토큰 발급 + 교환 엔드포인트(토큰셋 반환).
- **스토어프론트**: 결제 리다이렉트 시 핸드오프 토큰을 받아 `…/pay/{intentId}?h=<code>` 로 이동.
- **wallet-web `/pay`**: 유효 세션이 없고 `?h=` 가 있으면 **서버에서 교환 → 자기 host-only 세션쿠키 발급 → 파라미터 제거 후 진행**. 없으면 기존 `/auth/ensure` 폴백.

인앱브라우저에서도 동작하는 이유: 토큰이 **first-party 네비게이션(URL)** 으로 전달되고 wallet-web 이 **자기 도메인 쿠키를 직접** 심는다. 인앱브라우저/ITP 가 막는 것은 "남의 출처 쿠키 읽기"이지 first-party 쿠키 발급이 아니다. 1회용·단기·intent 바인딩이라 URL 노출은 안전하다.

### 3. (장기) 결제 흐름을 스토어프론트와 동일 출처로 통합

`www.almondyoung-next.com/pay/...` 경로에서 처리(CloudFront rewrite 또는 storefront 내 렌더)하면 서브도메인 교차 쿠키·silent SSO 가 원천 제거된다. 가장 견고하나 라우팅/CSP 변경 범위가 커서 2번 이후로 둔다.

## Consequences

- 1번만으로 "시간초과형"(다수)이 즉시 개선되고, 401 로그로 잔여 코호트를 계량할 수 있다.
- 2번 적용 후 인앱브라우저 고객까지 결제·배송지 저장이 정상화된다. IdP 에 핸드오프 엔드포인트가 추가되며, 토큰은 단기·1회용·intent 바인딩을 강제해야 한다.
- 운영 임시 대응(고객을 외부 브라우저로 유도, 입금완료 건 수동 복구)은 2번 배포 전까지 유지한다.
- 재발 진단을 위해 CloudFront 접속로그(또는 1번의 앱 레벨 UA 로그)를 상시 확보한다.
