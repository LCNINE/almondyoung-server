# almondyoung-storefront 모바일 앱 — 설계

- 작성일: 2026-07-27
- 상태: 승인됨 (구현 계획 대기)
- 범위: Android v1. iOS 는 후속 단계

## 1. 목표

`web/almondyoung-storefront` 를 감싸는 Android 앱을 만든다. 세 가지를 지원한다.

1. **탐색** — 쇼핑몰을 앱 안에서 탐색. 뒤로 가기 등 기본 동작이 자연스러울 것
2. **세션 소유** — 앱이 user-service 토큰을 보관해 자동 로그인을 제공하고, 이후 앱에 이식할
   기능(예: 고객센터 채팅)이 재로그인 없이 같은 토큰을 쓸 수 있을 것
3. **푸시 알림** — 앱을 설치하고 로그인한 회원에게 푸시 발송. 대상 고객을 선택해 발송할 수 있고,
   설치자와 마지막 앱 사용 시각을 조회할 수 있을 것

## 2. 비목표

v1 에서 하지 않는다.

- iOS 출시
- 네이티브 탭바 (§6.2 에 전환 경로만 열어둔다)
- 오프라인 캐싱, 로컬 웹 번들
- App Links 딥링크 (웹 링크로 앱 열기). 푸시 탭 라우팅은 앱 내부 처리로 충분하다
- 생체인증
- 앱 내 알림함 — 웹에서 만드는 편이 싸다
- 상품·주문 화면의 네이티브 재구현

## 3. 배경 — 이미 있는 자산

설계의 대부분은 기존 자산의 재사용이다. 조사 결과를 기록한다.

### 3.1 인증 (user-service)

| 자산 | 위치 | 비고 |
|---|---|---|
| OAuth 2.0 인가 서버 | `apps/user-service/src/api/oauth/` | authorization_code / refresh_token / payment_handoff 그랜트 |
| RFC 8252 redirect_uri 매칭 | `.../oauth/redirect-uri.ts` | public client 의 loopback 은 포트 무관, **커스텀 스킴은 exact match 허용** |
| internal code 발급 | `.../oauth/oauth.controller.ts` `POST /oauth/internal/issue-code` | `x-internal-secret` 보호. auth-web 전용 — **storefront 에 확산시키지 않는다** (§7.7) |
| 소셜 로그인 | 카카오 · 네이버 | Apple 은 없음 → iOS 단계의 과제 (§15) |

`redirect-uri.ts` 가 커스텀 스킴을 이미 허용하므로, 네이티브 앱 로그인에 필요한 서버 변경은
**클라이언트 등록 2건**(앱 public client 신규, `medusa-storefront` 에 redirect_uri 추가)뿐이다.
코드 변경은 없다.

### 3.1b Medusa 를 경유하는 로그인 체인

storefront 는 OAuth 클라이언트가 아니다. 실제 클라이언트는 **Medusa** 이며, 세션도 두 겹이다.
설계상 가장 중요한 제약이라 §7.1 에 별도로 정리한다.

| 자산 | 위치 |
|---|---|
| SSO 프로바이더 | `apps/medusa/src/modules/user-service-sso/service.ts` (`authenticate` / `validateCallback`) |
| 콜백 라우트 | `web/almondyoung-storefront/src/app/[countryCode]/(auth)/callback/oidc/route.ts` |
| 콜백 처리 | `.../src/lib/api/medusa/sso.ts` (`startOidcLogin` / `oidcCallback`) |

`validateCallback` 은 `entity_id = id_token.sub` (= user-service userId) 로 auth_identity 를
잡고, 없으면 생성한다. 그 뒤 `oidcCallback` 이 `actor_id` 부재를 감지해 `POST /store/customers`
+ `POST /auth/token/refresh` 로 customer 를 만든다. **신규 사용자 처리가 이 두 곳에 걸쳐 있다.**

### 3.2 푸시 (notification)

| 자산 | 위치 | 비고 |
|---|---|---|
| FCM 프로바이더 | `apps/notification/src/provider/providers/push/fcm.provider.ts` | |
| 토큰 등록/해제 API | `.../device/controllers/device.controller.ts` | `POST` / `DELETE /devices/fcm-token`, `JwtUserGuard` |
| `fcm_tokens` 테이블 | `apps/notification/database/schemas/notification-schema.ts` | `userId` `token` `deviceId` `platform` `appVersion` `osVersion` `deviceModel` `deviceName` `isActive` `isPrimary` **`lastUsedAt`** `topics` |
| `PUSH` 채널 | `.../shared/enums/index.ts` | `Channel.PUSH` |
| 대량 캠페인 | `.../bulk/` | `ALL_USERS` / `SELECTED_USERS` / `FILTERED_USERS`, 예약 발송, Bull 큐 |

요구사항 3 의 데이터 모델은 이미 완성돼 있다. `lastUsedAt` 이 "마지막 앱 사용 기록"을 그대로 담는다.

### 3.3 storefront

| 자산 | 위치 | 비고 |
|---|---|---|
| 부모 도메인 쿠키 세션 | `src/lib/auth/parent-cookies.ts` | `setParentAuthCookies()`, access 15분 / refresh 14일(rememberMe 90일) |
| 토큰 자동 복구 | `src/middleware.ts` → `/api/auth/restore-token` | `accessToken` 만료 시 `refreshToken` 으로 자동 복구 — 앱 자동 로그인이 여기 얹힌다 (§7.5) |
| OIDC 콜백 route handler | `src/app/[countryCode]/(auth)/callback/oidc/route.ts` | **앱이 그대로 재사용하는 라우트** (§7.3). `location.replace` 로 히스토리에서 콜백 URL 제거 |
| 모바일 하단바 | `src/components/layout/nav/bottom-nav.tsx` | `xl:hidden` `fixed bottom-0` `pb-safe`, 5개 항목 |
| safe-area | `src/app/layout.tsx` `viewportFit: "cover"` + `globals.css` `pb-safe` | 전체화면 웹뷰에서 하단바가 홈 인디케이터를 피해 렌더됨 |
| 웹 FCM | `src/lib/firebase/firebase.ts` | Firebase 프로젝트가 이미 존재 → Android 앱만 추가하면 됨 |

하단바 5개 중 **카테고리와 검색은 링크가 아니라 웹 시트 트리거**다 (`CategorySheet`,
`useSearchSheetStore`). 네이티브 탭바로 대체하기 어려운 이유이며 §6.2 의 근거다.

### 3.4 admin-web

`src/app/api/proxy/notification/[...path]/route.ts` 프록시는 있으나 **푸시 캠페인 화면은 없다.**
`mall/marketing/campaigns` 는 Medusa 프로모션이다.

### 3.5 기존 네이티브 앱

`native/warehouse-app` 은 Tauri 2 + React 19 + TanStack Router. `plugin-deep-link`,
`plugin-stronghold` 로 PKCE OIDC 와 보안 토큰 저장을 이미 구현했다. 재사용되는 것은 **개념**이지
코드가 아니다.

## 4. 결정과 근거

| # | 결정 | 근거 |
|---|---|---|
| D1 | **Android 선출시, iOS 후속** | iOS 는 Sign in with Apple(§15) 과 IAP 대응이 선행돼야 한다. Android 만 내면 v1 범위가 크게 줄고 검증이 빨라진다 |
| D2 | **멤버십 결제는 Android 웹뷰에 그대로 노출, iOS 에서는 숨김** | 실물 상품은 IAP 면제지만 구독은 아니다. Google Play 는 iOS 보다 외부 결제 여지가 넓다 |
| D3 | **Expo (React Native) + `react-native-webview`** | §5 |
| D4 | **크롬리스 웹뷰 + 시스템 제스처** | §6 |
| D5 | **웹뷰 세션과 앱 세션을 분리. 토큰을 넘기지 않는다** | §7.2 |
| D6 | **웹뷰가 authorization code 를 직접 상환** — 세션 이식·핸드오프·신규 엔드포인트 모두 불필요 | §7.3. `validateCallback` 이 state 를 서버 측에서 조회하므로 브라우저 컨텍스트 의존이 없다 |
| D7 | **앱 컨텍스트는 User-Agent 접미사로 주입** | §8 |
| D8 | **raw FCM 토큰 사용 (Expo Push 서비스 우회)** | 서버의 `fcm.provider.ts` 와 `POST /devices/fcm-token` 이 그대로 맞아 서버 변경이 0 |

## 5. 프레임워크 — Expo (RN)

`react-native-webview` 위에 Expo 로 셸을 만든다.

**선택 이유**

- 필요한 조각이 전부 1급으로 존재한다: `expo-notifications`(FCM), `expo-auth-session`(PKCE),
  `expo-secure-store`(Keystore), `expo-web-browser`(Custom Tabs), `react-native-webview`
- **EAS Update** 로 JS 번들을 스토어 심사 없이 배포할 수 있다. 웹뷰 셸은 로직이 얇고 수정이 잦아
  이 성질이 특히 잘 맞는다
- EAS Build 로 Mac 없이 빌드하고, config plugins 로 `android/` 를 커밋하지 않는다
- 팀이 React/TypeScript 를 쓰므로 학습 곡선이 낮다
- 이후 네이티브 화면(고객센터 채팅)을 붙이는 경로가 자연스럽다

**검토 후 제외**

- **Tauri 2 mobile** — 스택 통일과 팀 친숙도는 매력적이나, **1급 FCM 푸시 플러그인이 없어**
  Kotlin/Rust 플러그인을 직접 작성해야 한다. 앱 전문 인력이 없다는 전제와 충돌하며 하필 이
  프로젝트의 핵심 요구다. 원격 사이트를 감싸는 웹뷰 제어 API 도 `react-native-webview` 대비 얕다
- **Capacitor** — 모델이 로컬 번들 정적 자산인데 storefront 는 Next.js SSR 이라 static export 가
  불가능하다. `server.url` 원격 로드는 공식 문서상 개발용이며, 그렇게 쓰면 Capacitor 의 이점이
  사라진다. 네이티브 화면 확장 경로도 약하다
- **PWA / TWA** — 최소 비용으로 Play 등재는 가능하나 앱이 세션을 소유할 수 없고 네이티브 확장이
  불가능해 요구사항 2·3 과 충돌한다
- **Flutter, 네이티브 2벌** — 인력 전제상 제외

## 6. 탐색 UX

### 6.1 문제 재정의

웹 하단바는 **목적지 탭**(홈/카테고리/검색/장바구니/마이페이지)이고, 앱이 필요로 하는 것은
**히스토리 이동**이다. 서로 다른 층위인데 둘 다 관습적으로 하단에 놓여 충돌하는 것처럼 보인다.

히스토리 이동은 모바일 OS 가 이미 시스템 제스처로 제공한다. 따라서 **앱은 탐색 UI 를 그리지
않는다.**

### 6.2 설계

- 웹뷰가 전체 화면. 앱 크롬 0. 웹 하단바가 유일한 탭바
- Android 백 버튼/제스처 → `webview.goBack()`. 히스토리 루트에서는 "한 번 더 누르면 종료" 토스트
  후 두 번째 입력에 종료
- Pull-to-refresh 활성화 — 새로고침 UI 를 따로 그리지 않아도 된다
- iOS 단계에서 `allowsBackForwardNavigationGestures` 로 엣지 스와이프 백

**예외 — 외부 도메인은 모달 웹뷰로 분리한다.** PG 결제창, 카카오·네이버 인증, 외부 정책 링크는
메인 웹뷰에 가두지 않고 **상단에 닫기 버튼이 있는 모달 웹뷰**로 띄운다. `onShouldStartLoadWithRequest`
에서 호스트를 판정해 분기한다. 미관이 아니라 안전장치다 — 외부 사이트에서 히스토리가 꼬이면
사용자가 앱에 갇힌다.

**네이티브 탭바로의 전환 경로.** 하단바 5개 중 카테고리·검색이 웹 시트 트리거(§3.3)라 네이티브
탭으로 표현하려면 브릿지가 필요하고, 탭 구성이 바뀔 때마다 앱을 다시 내야 한다. v1 에서는 하지
않는다. 다만 앱이 컨텍스트를 주입하므로(§8) 전환 시점에는 storefront 에서 `BottomNavigation` 을
조건부로 끄기만 하면 된다.

## 7. 세션 관리

### 7.1 현재 구조 — 세션은 두 겹이다

| 쿠키 | 발급 주체 | 역할 |
|---|---|---|
| `_medusa_jwt` | Medusa | **고객 세션의 SoT.** `/mypage` 게이트, 장바구니, 주문 |
| `accessToken` / `refreshToken` | user-service | user-service API 호출용 (부모 도메인 쿠키) |

**OAuth 클라이언트는 storefront 가 아니라 Medusa** (`medusa-storefront`) 다. 로그인은
`startOidcLogin` → Medusa `POST /auth/customer/user-service-sso` → auth-web `/oauth/authorize`
→ user-service → Medusa `validateCallback` 순으로 흐르고, Medusa 가
`{ token, idp_tokens }` 를 반환하면 storefront 가 두 쿠키를 함께 심는다.

즉 **authorization code 1장이 양쪽 토큰을 모두 낳는다.** user-service 토큰을 Medusa 토큰으로
바꾸는 경로는 존재하지 않는다.

### 7.2 원칙 — 토큰을 넘기지 않고, 각자 자기 클라이언트로 받는다

웹뷰 세션과 앱 세션을 **분리한다.** 웹뷰는 Medusa 클라이언트의 세션을, 앱은 자기 public client
의 토큰을 각각 정규 OIDC 흐름으로 획득한다. 둘 사이에 토큰을 전달하지 않으므로 핸드오프 토큰도,
세션 부트스트랩 엔드포인트도, internal secret 확산도 필요 없다.

### 7.3 웹뷰 세션 — authorization code 를 웹뷰가 상환한다

핵심 사실: `validateCallback` 은 `authIdentityService.getState(stateKey)` 로 **state 를 Medusa
서버 측에서 조회**하고, `code_verifier` 도 그 state 안에 있다. 콜백 경로 전체에 브라우저 쿠키
의존이 없다. 따라서 **authorization code 는 어느 클라이언트 컨텍스트에서 상환해도 된다.**

세션을 이식하는 것이 아니라, code 를 브라우저 대신 웹뷰가 상환하게 한다.

```
1. 앱   WebBrowser.openAuthSessionAsync 로 Custom Tabs 오픈
        (startOidcLogin 의 callback_url = almondyoung://callback/oidc)
2. 사용자  auth-web 에서 로그인 — 카카오·네이버 정상 동작 (진짜 브라우저)
3. IdP  → almondyoung://callback/oidc?code=&state=   → 앱이 수신
4. 앱   웹뷰를 https://<origin>/{countryCode}/callback/oidc?code=&state= 로 로드
5. 웹뷰  기존 라우트가 그대로 실행 → _medusa_jwt + 부모 쿠키가 웹뷰에 심김
```

- **신규 엔드포인트 0개.** 4단계가 부르는 것은 이미 있는
  `src/app/[countryCode]/(auth)/callback/oidc/route.ts` 다
- **신규 사용자 처리가 자동으로 따라온다.** 웹과 완전히 같은 코드 경로이므로 `validateCallback`
  의 auth_identity create 분기와 `oidcCallback` 의 customer 생성 + `/auth/token/refresh` 분기가
  그대로 동작한다 (§3.3)
- **code 가 앱을 경유해도 안전하다.** `code_verifier` 는 Medusa 의 state 안에만 있으므로 탈취된
  code 는 Medusa 없이 교환할 수 없다. PKCE 가 정확히 이 상황을 위한 장치다

**필요한 변경은 설정 1건이다** — user-service 의 `medusa-storefront` 클라이언트에 redirect_uri
`almondyoung://callback/oidc` 를 추가 등록한다. `exchangeCode` 가 `state.callback_url` 을
`redirect_uri` 로 그대로 보내므로 등록되어 있어야 매칭된다.

### 7.4 앱 세션 — 표준 public client

앱은 **자기 OAuth public client** 로 별도 PKCE authorization_code 흐름을 수행해 자기
accessToken / refreshToken 을 받고 `expo-secure-store` 에 저장한다 (Android Keystore 뒷받침).
이후 네이티브 화면(고객센터 채팅 등)이 이 토큰을 쓴다.

- redirect: `almondyoung://oauth/callback` — 7.3 의 `almondyoung://callback/oidc` 와 **경로를
  구분**해 두 흐름의 콜백이 섞이지 않게 한다
- `redirect-uri.ts` 가 public client 의 커스텀 스킴을 exact match 로 허용하므로 서버 코드 변경은
  없다. public 클라이언트 1건 등록만 필요하다

**순서가 중요하다: 7.4 를 먼저, 7.3 을 나중에 실행한다.** 7.4 에서 사용자가 실제로 로그인하면
Custom Tabs 브라우저에 IdP 세션 쿠키가 생기고, 이어지는 7.3 의 authorize 는 그 세션을 만나
사용자 상호작용 없이 즉시 리다이렉트된다. **사용자에게 보이는 로그인은 한 번뿐이다.**

### 7.5 자동 로그인

Android WebView 의 쿠키 저장소는 영속되므로 재실행 시 웹뷰 세션이 유지된다. `accessToken`(15분)
이 만료되면 기존 미들웨어 경로(`refreshToken` → `/api/auth/restore-token`)가 자동 복구한다.

쿠키가 유실되거나 `refreshToken`(14~90일)까지 만료되면 7.4 → 7.3 을 다시 실행한다. IdP 세션이
살아 있으면 무음으로 끝나고, 아니면 정상 로그인 화면이 뜬다.

### 7.6 로그아웃

웹에서 로그아웃하면 storefront 가 `window.ReactNativeWebView.postMessage()` 로
`{ type: 'auth/logout' }` 를 보내고, 앱이 `onMessage` 로 받는다. 앱은 SecureStore 를 비우고
`DELETE /devices/fcm-token` 으로 FCM 토큰을 비활성화한 뒤 SplashGate 로 돌아간다.
**이 처리가 없으면 로그아웃한 사용자에게 푸시가 계속 간다.**

브릿지 메시지는 `type` 을 가진 JSON 이며, 수신 측은 알 수 없는 `type` 을 무시한다. 앱과 웹의
배포 시점이 다르므로 양방향 모두 이 규칙을 지킨다.

### 7.7 보안 메모

- **토큰을 두 컨텍스트 사이로 옮기지 않는다.** 앱↔웹 브릿지는 세션 토큰을 전달하지 않고 상태
  통지(로그아웃 등)만 주고받는다. refreshToken 은 웹 JS 에 노출되지 않는다
- **internal secret 은 storefront 에 배포하지 않는다.** `POST /oauth/internal/issue-code` 는
  임의 userId 로 code 를 발급할 수 있는 primitive 이므로 인가 서버 신뢰 경계(auth-web) 안에만
  둔다. relying party 인 storefront 가 가지면 클라이언트가 임의 사용자를 사칭할 수 있게 된다
- 앱을 경유하는 authorization code 는 1회용이고 PKCE 로 보호된다 (§7.3). 콜백 URL 은 웹뷰
  히스토리에 남으므로 기존 OIDC 콜백의 `location.replace` 패턴이 그대로 제거한다
- **`id_token` 을 자격증명으로 쓰지 않는다.** id_token 은 특정 `aud` 앞으로 발행된 인증 주장이며,
  다른 컴포넌트가 이를 받아 세션을 발급하면 audience confusion 에 노출된다

## 8. 앱 컨텍스트 주입

iOS 멤버십 숨김(D2), 향후 하단바 제어, 앱 전용 UI 에 필요하다.

- RN WebView 의 `applicationNameForUserAgent` 로 UA 접미사를 붙인다:
  `AlmondyoungApp/<version> (android)`
- storefront `middleware.ts` 에서 UA 를 파싱해 요청 헤더로 정규화한다 → 서버 컴포넌트가
  `isApp` / `appPlatform` / `appVersion` 을 읽는다

쿠키가 아니라 UA 를 쓰는 이유: storefront 가 SSR 중심이라 **첫 요청부터** 판정이 필요하고,
쿠키 동의·삭제와 무관해야 한다.

## 9. 푸시 알림

### 9.1 앱

- `expo-notifications` 의 `getDevicePushTokenAsync()` 로 **raw FCM 토큰**을 얻는다.
  Expo Push 서비스를 경유하지 않으므로 기존 서버 API 가 그대로 맞는다
- **등록 시점은 로그인 완료 후.** `fcm_tokens.userId` 가 필수라 익명 상태에서는 등록할 수 없다
- 권한: Android 13+ `POST_NOTIFICATIONS` 런타임 권한. 앱 첫 실행이 아니라 **로그인 직후 또는 첫
  주문 완료 후**에 요청한다 — 맥락이 있을 때 승낙률이 높다
- 등록 payload: `platform: 'android'`, `deviceId`(설치 고유 ID), `appVersion`, `osVersion`,
  `deviceModel`. 모두 스키마에 있는 컬럼이다
- 알림 탭 → payload 의 경로로 웹뷰 이동
- 포그라운드 진입마다 토큰을 재등록(upsert)해 `lastUsedAt` 을 갱신한다

**딥링크 payload 계약 (앱↔발송 쪽 계약, 서버가 자동으로 채워주지 않음)**: FCM
data payload 에 **정확히 `path`** 라는 키로 이동할 경로를 담아야 한다. 앱은
`content.data?.path` 를 읽어 `typeof path !== "string"` 이거나 `/` 로 시작하지
않으면 조용히 무시하고, 유효하면 `${storefrontOrigin}${path}` 로 그대로 이동한다
(별도 로케일 보정 없음). 값은 **국가 프리픽스를 포함한 절대 경로**여야 한다 —
예: `/kr/products/123` (O), `/products/123` (✗, 국가 프리픽스 없이 보내면
storefront 라우팅이 깨진다). 예시 payload:

```json
{ "data": { "path": "/kr/products/123" } }
```

`fcm.provider.ts` 는 `notificationId`/`campaignId`/`category`/`priority`/
`clickAction`/`sound` 와 caller 가 넘긴 `metadata.fcmDataVariables` 만 채운다 —
`path` 를 자동으로 만들어주지 않으므로, §9.2(b) 캠페인 발송 UI/로직을 구현하는
쪽이 이 계약대로 `path` 를 명시적으로 채워 보내야 한다. (`clickAction` 이
이미 있다고 그걸 재활용하면 안 된다 — 앱은 오직 `path` 만 읽는다.)

### 9.2 서버 — 신규 작업 2건

**(a) 앱 사용자 조회 API (notification)**

현재 `POST /notifications/bulk` 는 프론트가 *완성된 user list* 를 보내는 구조라, admin 이
"앱 설치 + 로그인한 고객"을 **찾을** 수단이 없다. `fcm_tokens` 를 조회하는 엔드포인트를 추가한다.

```
GET /devices/app-users
  ?platform=android|ios|web        (선택, 복수)
  &activeSince=<ISO8601>           (선택, lastUsedAt 하한)
  &isActive=true                   (기본 true)
  &page=&size=
→ { items: [{ userId, platform, appVersion, deviceModel, lastUsedAt }], total, page, size }
```

`userId` 목록을 반환하고, 이메일·전화·마케팅 동의 여부는 admin-web 이 user-service 프로필 조회와
합친다 — 서비스 간 DB 조인을 만들지 않기 위해서다. 반환된 목록이 그대로
`CreateBulkNotificationDto.audience.users` 의 입력이 된다.

이 API 가 요구사항 3 의 "설치자 특정"과 "마지막 사용 기록 조회"를 함께 충족한다.

**(b) admin-web 푸시 캠페인 화면**

대상 선택 → 내용 작성 → 예약 → 발송 결과. `src/app/api/proxy/notification/[...path]` 프록시가
이미 있어 배선은 짧다.

**법적 게이트를 UI 에서 강제한다.** 마케팅 푸시는 정보통신망법상 수신동의와 야간(21~08시)
광고성 정보 전송 제한을 받는다. `NotificationCategory.MARKETING` 과 `isMarketingEnabled` 가 이미
분리돼 있으므로, 카테고리가 `MARKETING` 일 때 미동의자를 대상에서 제외하고 야간 예약을 막는다.

## 10. 오류 처리

크롬리스 웹뷰라 실패가 그대로 노출된다. 브라우저 기본 에러 페이지가 뜨면 앱 품질이 무너지므로
네이티브가 가로챈다.

| 상황 | 처리 |
|---|---|
| 네트워크 없음 / 로드 실패 | `onError` → 네이티브 오프라인 화면 + 재시도 버튼 |
| 로그인 흐름 실패·취소 (§7.3/§7.4) | **비로그인 상태로 웹뷰 진입.** 세션 실패로 앱이 갇히면 안 된다 |
| code 상환 실패 (만료·재사용) | 콜백 라우트가 기존 에러 HTML 을 렌더한다. 앱은 이를 감지해 로그인 재시작 |
| 웹뷰 쿠키·refreshToken 만료 | §7.4 → §7.3 재실행. IdP 세션이 살아 있으면 무음 |
| FCM 등록 실패 | 조용히 백오프 재시도. 앱 사용을 막지 않는다 |
| Android WebView 프로세스 종료 | `onRenderProcessGone` 처리 후 웹뷰 재생성. 미처리 시 앱이 통째로 죽는다 |

## 11. 코드 배치와 모듈 구조

`native/storefront-app/` — `warehouse-app` 옆. warehouse-app 과 같이 **독립 lockfile** 을 쓴다.
Expo 의 Metro 번들러는 monorepo hoisting 에 민감해 루트 워크스페이스 편입은 이득보다 손실이 크다.

화면 3개:

| 화면 | 책임 |
|---|---|
| `SplashGate` | 로그인 필요 판단 → 로그인 흐름 실행 → 웹뷰 첫 URL 결정 |
| `MainWebView` | storefront 전체화면. 앱 크롬 없음 |
| `ModalWebView` | 외부 도메인 전용. 상단 닫기 바 |

모듈 4개:

| 모듈 | 책임 | 의존 |
|---|---|---|
| `auth/` | 앱 public client PKCE 흐름 (§7.4), SecureStore 토큰 보관·갱신 | user-service `/oauth/*` |
| `login/` | 웹뷰 로그인 오케스트레이션 (§7.3) — Custom Tabs 로 code·state 수령 → 웹뷰 콜백 URL 생성 | `auth/`, Medusa `/auth/customer/user-service-sso` |
| `push/` | FCM 토큰 취득·등록·해제, 알림 탭 라우팅 | `auth/`, notification `/devices/fcm-token` |
| `bridge/` | 웹↔앱 postMessage 프로토콜 (상태 통지 전용) | 없음 |

각 모듈은 화면 컴포넌트를 모르고 순수 함수/서비스로 노출한다. 그래야 §12 의 단위 테스트가 가능하다.

## 12. 테스트

- `auth/` `login/` `bridge/` `push/` 는 네트워크·저장소를 주입받는 순수 TS 로직으로 두고 단위
  테스트한다. warehouse-app 이 vitest 를 쓰므로 맞춘다
- 웹뷰 상호작용(백 제스처, 외부 도메인 분기, pull-to-refresh)은 수동 스모크 체크리스트로 둔다.
  E2E 자동화는 v1 에 과투자다
- 서버 신규 조회 API 와 admin 화면은 각 앱의 기존 테스트 관례를 따른다

## 13. 배포

- EAS Build (Android AAB) → EAS Submit (Play Console)
- JS 수정은 EAS Update 로 심사 없이 배포. 네이티브 모듈이 바뀔 때만 스토어 빌드를 올린다
- 채널: `preview`(내부 테스트) / `production`

**사전 준비**

- Play Console 계정 ($25 1회)
- user-service 클라이언트 등록 2건 (`admin/oauth-clients` API 존재)
  - 앱 public client 신규 — redirect_uri `almondyoung://oauth/callback`
  - 기존 `medusa-storefront` 에 redirect_uri `almondyoung://callback/oidc` 추가
- 기존 Firebase 프로젝트에 Android 앱 추가 + `google-services.json`

**배포 순서: 클라이언트 등록 → storefront 배포 → 앱 제출.** 앱은 롤백이 느리므로 서버가 항상
먼저다. user-service 와 notification 은 이 설계에서 코드 변경이 없다. DB 마이그레이션이 필요하면
CLAUDE.md 의 expand phase 규칙(`migrate → deploy`)을 따르되, 현재 설계는 신규 컬럼을 요구하지
않으므로 마이그레이션은 0건이다.

## 14. 구현 순서

작업을 **두 개의 구현 계획으로 분리한다.**

### 계획 A — 앱 (이 스펙의 주 산출물)

각 단계는 앞 단계 없이 검증할 수 없어 순서가 강제된다.

| 단계 | 내용 | 산출물 |
|---|---|---|
| 1 | user-service 클라이언트 등록 2건 — 앱 public client 신규, `medusa-storefront` 에 redirect_uri `almondyoung://callback/oidc` 추가 | 설정 |
| 2 | storefront: `middleware.ts` UA 파싱, 앱 컨텍스트 노출 (§8) | 웹 |
| 3 | Expo 앱 셸: `auth/` `login/` + SplashGate·MainWebView·ModalWebView, 백 제스처, 외부 도메인 분기 | 앱 |
| 4 | Expo 앱 `push/` + storefront 로그아웃 브릿지 | 앱 + 웹 |
| 5 | EAS 빌드·내부 테스트 채널 배포, 수동 스모크 체크리스트 | 배포 |

1단계는 코드 변경이 없다. 3단계까지 끝나면 "로그인된 상태로 쇼핑몰을 탐색하는 앱"이 동작하고,
4단계에서 푸시 수신이 가능해진다.

### 계획 B — 푸시 발송 운영 (별도 계획)

`GET /devices/app-users` (§9.2a) 와 admin-web 푸시 캠페인 화면 (§9.2b).

**계획 A 와 독립적으로 진행한다.** 검증 시점이 다르고, 계획 A 만으로도 사내 테스트 발송은
`POST /notifications/bulk` 직접 호출로 가능하다. 다만 **계획 A 4단계가 끝나야 실제 수신 대상이
생기므로**, 계획 B 의 통합 검증은 그 이후다.

## 15. 후속 단계 (iOS)

v1 이후 iOS 를 낼 때 선행해야 할 것.

1. **Sign in with Apple** — App Store 심사 가이드라인 4.8 은 타사 소셜 로그인으로 주 계정을
   생성·인증하는 앱에 동등한 대안을 요구하며, WeChat 같은 지역 사업자도 대상에 포함한다.
   카카오·네이버가 여기 걸린다. user-service 에 Apple OIDC 프로바이더 추가와 기존 계정 연동·병합
   처리가 필요하다
2. **멤버십 진입점 숨김** — §8 의 앱 컨텍스트로 `appPlatform === 'ios'` 일 때 구독 결제 진입점을
   가린다 (D2)
3. **4.2 Minimum Functionality** — 순수 웹 래퍼는 리젝 사유다. 푸시와 네이티브 로그인이 있으면
   대개 통과하지만, 네이티브 화면(예: 고객센터 채팅)이 하나 있으면 안전해진다
4. Apple Developer Program ($99/년), `allowsBackForwardNavigationGestures` 활성화
