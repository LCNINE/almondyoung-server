# 인증 토큰 refresh 책임 경계

admin-web 의 OIDC 토큰 refresh 는 세 경로로 나뉘어 있다. 각 경로의 역할을 명확히 두지 않으면 다중 탭/race 시나리오에서 refresh-token rotation 의 reuse detection 에 걸려 사용자가 강제 로그아웃된다. 이 문서는 그 경계를 못박는다.

## 3 경로 요약

| 경로 | 위치 | 트리거 | 동작 |
|------|------|--------|------|
| **middleware** | `src/middleware.ts` (Edge runtime) | 사용자 페이지 네비게이션마다 | accessToken 검증 → 만료 5분 전 또는 만료된 경우 user-service `/oauth/token` 직접 호출 → 응답 쿠키에 새 토큰 set |
| **axios interceptor** | `src/lib/api/client.ts` (브라우저) | 도메인 API 호출이 401 응답을 받았을 때 | `/api/auth/refresh` 호출 후 원 요청 재시도 |
| **refresh route** | `src/app/api/auth/refresh/route.ts` (Node runtime) | axios interceptor 가 호출 | user-service `/oauth/token` 호출, 응답 쿠키에 새 토큰 set |

## 책임 분담

- **middleware** = **SSR 안정성**. 페이지 렌더가 만료된 토큰으로 진행되어 모든 서버 컴포넌트가 500 으로 깨지는 것을 막는다. 사용자 네비게이션 시점에만 동작하므로 race 빈도는 낮다.
- **axios interceptor** = **클라이언트 측 API 호출의 자가 복구**. 페이지 진입 후 발생하는 API 호출(`useQuery`, mutation, 등) 중 토큰 만료로 401 이 떨어지면 사용자가 모르게 retry.
- **refresh route** = **axios interceptor 의 위임자**. 토큰 교환과 쿠키 재발급은 서버 측에서만 가능하므로 브라우저 axios 는 이 라우트를 통해 갱신한다. middleware 와 동일한 user-service `/oauth/token` 을 호출하지만, 브라우저 쿠키 jar 갱신을 위해 별도 Next 라우트가 필요.

## 다중 탭 안전성

핵심 race: 두 탭이 동시에 401 → 두 탭이 각자 `/api/auth/refresh` 호출 → user-service 가 첫 호출에서 refresh-token 을 회전 → 두 번째 호출이 이미 사용된 refresh-token 으로 도착 → **reuse detection 발동 → 강제 로그아웃**.

`src/lib/api/client.ts` 의 `refreshAccessToken()` 은 이를 막기 위해 **Web Locks API (`navigator.locks`)** 로 같은 origin 의 모든 탭/iframe 에 걸쳐 refresh 호출을 직렬화한다.

- 락 이름: `admin-web:auth-refresh` (exclusive)
- 락을 잡은 첫 탭만 실제 `/api/auth/refresh` 호출. 호출 성공 시 `localStorage['admin-web:last-auth-refresh']` 에 timestamp 기록.
- 락을 늦게 잡은 탭은 marker 가 `REFRESH_FRESH_WINDOW_MS` (10s) 내이면 refresh 를 **skip** 하고 원 요청만 재시도 — 브라우저 cookie jar 에 새 토큰이 이미 들어와 있으므로 그대로 200 응답.
- Web Locks 미지원 환경에서는 모듈 스코프 `inflight` Promise 만으로 같은 탭 내 single-flight 만 보장하고 다중 탭 race 는 잔존. 지원 범위 안에서 사실상 미발생.

### middleware ↔ axios interceptor race

두 탭이 거의 동시에 페이지 네비게이션을 일으키는 시나리오는 여전히 두 middleware 가 각각 refresh 를 호출할 수 있다. 이는 빈도가 매우 낮고 (사용자가 의도적으로 동시 클릭해야 발생), 또한 Edge runtime 에는 `navigator.locks` 가 없어 동일 패턴으로 막을 수 없다. 본 경계의 알려진 한계로 남겨두며, 만약 운영 중 발생 사례가 누적되면 다음 옵션을 검토:

1. middleware 의 preemptive window 단축 (5분 → 1분)
2. user-service 측 refresh-token reuse-grace 도입 (몇 초 내 동일 token 재요청 허용)

## server/client 모듈 경계

`src/lib/api/client.ts` 는 `'use client'` 모듈이며, 이를 import 하는 `src/lib/api/domains/**/*.ts` 도 전부 `'use client'` 를 박아 두었다. 서버 컴포넌트에서 도메인 client 함수를 호출하면 (`baseURL: '/api'` 의 상대 경로 / 브라우저 쿠키 의존 등으로) 정상 동작하지 않으므로, `'use client'` 디렉티브로 강제 경계를 만들어 실수를 차단한다.

서버에서 user-service API 를 호출해야 하면 `src/lib/auth/oidc-client.ts` 처럼 별도 `"server-only"` 모듈을 따로 만든다.

## 수동 검증 시나리오

PR 검증 시 아래를 수행:

1. 두 탭 모두 admin-web 동일 페이지 (예: `/users`) 열기.
2. DevTools → Application → Cookies 에서 `accessToken` 을 삭제 (refresh 강제 유발).
3. 두 탭에서 동시에 새로고침 또는 데이터 fetch 트리거.
4. DevTools → Network 에서 `/api/auth/refresh` 호출이 **두 탭 합쳐 1회만** 발생하는지 확인.
5. 두 탭 모두 정상 응답을 받고 로그아웃되지 않는지 확인.
