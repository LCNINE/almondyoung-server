# almondyoung-storefront 모바일 앱 (Android v1) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `web/almondyoung-storefront` 를 감싸는 Android 앱을 만들어, 자동 로그인된 상태로 쇼핑몰을 탐색하고 푸시 알림을 받을 수 있게 한다.

**Architecture:** Expo(React Native) + `react-native-webview` 로 만든 크롬리스 웹뷰 셸. 로그인은 Custom Tabs 에서 기존 Medusa OIDC 흐름을 수행하고, 발급된 authorization code 를 **웹뷰가 상환**해 기존 콜백 라우트가 그대로 세션을 심는다. 앱은 별도 public client 로 자기 토큰을 받아 SecureStore 에 보관한다. 서버 코드 변경은 없고 OAuth 클라이언트 등록 2건만 필요하다.

**Tech Stack:** Expo SDK, TypeScript, `react-native-webview`, `expo-web-browser`, `expo-auth-session`, `expo-secure-store`, `expo-notifications`, `expo-application`, `expo-device`, vitest

**Spec:** `docs/superpowers/specs/2026-07-27-storefront-mobile-app-design.md` (계획 A = 이 문서. 계획 B 는 별도)

## Global Constraints

- **플랫폼: Android 만.** iOS 코드 분기를 미리 만들지 않는다. 단, 플랫폼 판별 값은 `'android' | 'ios'` 로 열어 둔다
- **서버 코드 변경 0.** user-service · notification · Medusa 에 코드를 추가하지 않는다. DB 마이그레이션 0건
- **storefront 변경은 두 관심사로 한정한다** — (1) 앱 컨텍스트 주입: `src/middleware.ts` + `src/lib/app-context/{parse,server}.ts`, (2) 로그아웃 통지: `src/lib/app-context/notify-app.ts` + 호출 지점 2곳. 그 밖의 storefront 코드는 건드리지 않는다
- storefront 에는 테스트 러너가 없다(루트 jest 의 `roots` 가 `web/` 를 포함하지 않음). Task 2 에서 vitest 를 devDependency 로 도입한다 — 순수 TS 로직 전용이며 React 컴포넌트 테스트는 범위 밖이다
- **토큰을 두 컨텍스트 사이로 옮기지 않는다.** 앱↔웹 브릿지는 상태 통지만 주고받는다
- **`id_token` 을 자격증명으로 쓰지 않는다**
- **internal secret 을 앱이나 storefront 에 넣지 않는다**
- 앱 코드 위치: `native/storefront-app/` — **독립 lockfile** (루트 npm workspace 에 편입하지 않는다)
- 커스텀 스킴 2개를 구분해 쓴다: 웹뷰 로그인 = `almondyoung://callback/oidc`, 앱 자체 토큰 = `almondyoung://oauth/callback`
- 순수 로직(파싱·URL 생성·상태 판단)은 React 컴포넌트 밖 순수 함수로 두고 vitest 로 테스트한다. 네이티브 모듈은 주입받는다
- 커밋 메시지는 한국어, 레포 관례(`feat:` / `fix:` / `docs:`)를 따른다

---

### Task 1: Expo 프로젝트 스캐폴딩 + 앱 컨텍스트 UA

**Files:**
- Create: `native/storefront-app/package.json`
- Create: `native/storefront-app/app.config.ts`
- Create: `native/storefront-app/tsconfig.json`
- Create: `native/storefront-app/vitest.config.ts`
- Create: `native/storefront-app/.env.example`
- Create: `native/storefront-app/src/config/env.ts`
- Create: `native/storefront-app/src/app-context/user-agent.ts`
- Test: `native/storefront-app/src/app-context/user-agent.test.ts`

**Interfaces:**
- Consumes: 없음 (첫 태스크)
- Produces:
  - `buildUserAgentSuffix(input: { appVersion: string; platform: 'android' | 'ios' }): string`
  - `appEnv: { storefrontOrigin: string; medusaUrl: string; medusaPublishableKey: string; authWebOrigin: string; appClientId: string; defaultCountryCode: string }`

- [ ] **Step 1: Expo 프로젝트 생성**

```bash
cd native
npx create-expo-app@latest storefront-app --template blank-typescript
cd storefront-app
npx expo install react-native-webview expo-web-browser expo-auth-session expo-crypto \
  expo-secure-store expo-notifications expo-application expo-device expo-constants
npm i -D vitest
```

- [ ] **Step 2: 루트 워크스페이스 편입 방지 확인**

`native/storefront-app/package.json` 이 자체 `package-lock.json` 을 갖는지 확인한다. 루트 `package.json` 의 `workspaces` 에 `native/*` 가 있으면 제거한다.

Run: `cd /home/pauseb/workspace/almondyoung-server && node -e "console.log(require('./package.json').workspaces ?? 'none')"`
Expected: `native/storefront-app` 이 포함되지 않을 것

- [ ] **Step 3: 실패하는 테스트 작성**

`native/storefront-app/src/app-context/user-agent.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { buildUserAgentSuffix } from "./user-agent"

describe("buildUserAgentSuffix", () => {
  it("앱 이름·버전·플랫폼을 담은 접미사를 만든다", () => {
    expect(buildUserAgentSuffix({ appVersion: "1.0.0", platform: "android" }))
      .toBe("AlmondyoungApp/1.0.0 (android)")
  })

  it("iOS 플랫폼도 같은 형식을 쓴다", () => {
    expect(buildUserAgentSuffix({ appVersion: "2.3.1", platform: "ios" }))
      .toBe("AlmondyoungApp/2.3.1 (ios)")
  })
})
```

- [ ] **Step 4: 테스트 실패 확인**

Run: `cd native/storefront-app && npx vitest run src/app-context/user-agent.test.ts`
Expected: FAIL — `Failed to resolve import "./user-agent"`

- [ ] **Step 5: 구현**

`native/storefront-app/src/app-context/user-agent.ts`:

```ts
export type AppPlatform = "android" | "ios"

/**
 * WebView 의 applicationNameForUserAgent 에 넣을 접미사.
 * storefront middleware 가 이 문자열을 파싱해 앱 컨텍스트를 판정한다.
 */
export function buildUserAgentSuffix(input: {
  appVersion: string
  platform: AppPlatform
}): string {
  return `AlmondyoungApp/${input.appVersion} (${input.platform})`
}
```

- [ ] **Step 6: 테스트 통과 확인**

Run: `cd native/storefront-app && npx vitest run src/app-context/user-agent.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 7: 환경 설정 작성**

`native/storefront-app/src/config/env.ts`:

```ts
function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing required env var: ${name}`)
  return value
}

export const appEnv = {
  storefrontOrigin: required(
    "EXPO_PUBLIC_STOREFRONT_ORIGIN",
    process.env.EXPO_PUBLIC_STOREFRONT_ORIGIN,
  ),
  medusaUrl: required("EXPO_PUBLIC_MEDUSA_URL", process.env.EXPO_PUBLIC_MEDUSA_URL),
  medusaPublishableKey: required(
    "EXPO_PUBLIC_MEDUSA_PUBLISHABLE_KEY",
    process.env.EXPO_PUBLIC_MEDUSA_PUBLISHABLE_KEY,
  ),
  authWebOrigin: required("EXPO_PUBLIC_AUTH_WEB_ORIGIN", process.env.EXPO_PUBLIC_AUTH_WEB_ORIGIN),
  appClientId: required("EXPO_PUBLIC_APP_OAUTH_CLIENT_ID", process.env.EXPO_PUBLIC_APP_OAUTH_CLIENT_ID),
  defaultCountryCode: process.env.EXPO_PUBLIC_DEFAULT_COUNTRY_CODE ?? "kr",
}
```

`native/storefront-app/.env.example`:

```
EXPO_PUBLIC_STOREFRONT_ORIGIN=https://almondyoung.com
EXPO_PUBLIC_MEDUSA_URL=https://medusa.almondyoung.com
EXPO_PUBLIC_MEDUSA_PUBLISHABLE_KEY=pk_...
EXPO_PUBLIC_AUTH_WEB_ORIGIN=https://auth.almondyoung.com
EXPO_PUBLIC_APP_OAUTH_CLIENT_ID=almondyoung-android-app
EXPO_PUBLIC_DEFAULT_COUNTRY_CODE=kr
```

- [ ] **Step 8: app.config.ts 에 커스텀 스킴 등록**

`native/storefront-app/app.config.ts`:

```ts
import type { ExpoConfig } from "expo/config"

const config: ExpoConfig = {
  name: "아몬드영",
  slug: "almondyoung-storefront-app",
  version: "1.0.0",
  orientation: "portrait",
  scheme: "almondyoung",
  android: {
    package: "com.almondyoung.storefront",
    versionCode: 1,
  },
  plugins: ["expo-secure-store", "expo-notifications", "expo-web-browser"],
}

export default config
```

- [ ] **Step 9: 커밋**

```bash
git add native/storefront-app
git commit -m "feat(storefront-app): Expo 프로젝트 스캐폴딩 및 앱 컨텍스트 UA 접미사"
```

---

### Task 2: storefront 앱 컨텍스트 파싱

**Files:**
- Create: `web/almondyoung-storefront/vitest.config.ts`
- Modify: `web/almondyoung-storefront/package.json` (vitest devDependency + test 스크립트)
- Create: `web/almondyoung-storefront/src/lib/app-context/parse.ts`
- Create: `web/almondyoung-storefront/src/lib/app-context/server.ts`
- Modify: `web/almondyoung-storefront/src/middleware.ts`
- Test: `web/almondyoung-storefront/src/lib/app-context/parse.test.ts`

**Interfaces:**
- Consumes: Task 1 의 UA 형식 `AlmondyoungApp/<version> (<platform>)`
- Produces:
  - `parseAppContext(userAgent: string | null | undefined): AppContext | null`
  - `type AppContext = { platform: 'android' | 'ios'; version: string }`
  - `APP_CONTEXT_HEADER = 'x-almondyoung-app'`
  - `getAppContext(): Promise<AppContext | null>` — 서버 컴포넌트용

- [ ] **Step 0: vitest 도입**

storefront 에는 테스트 러너가 없다. 순수 TS 로직 전용으로 들인다.

```bash
cd web/almondyoung-storefront
npm i -D vitest
```

`package.json` 의 `scripts` 에 추가한다:

```json
    "test": "vitest run",
    "test:watch": "vitest"
```

`web/almondyoung-storefront/vitest.config.ts` 를 만든다. Next 플러그인 없이 순수 TS 만 대상으로 한다:

```ts
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
})
```

`include` 를 `*.test.ts` 로 한정해 `.tsx` 컴포넌트 테스트가 딸려 들어오지 않게 한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`web/almondyoung-storefront/src/lib/app-context/parse.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { parseAppContext } from "./parse"

describe("parseAppContext", () => {
  it("앱 UA 접미사에서 플랫폼과 버전을 뽑는다", () => {
    const ua = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 AlmondyoungApp/1.0.0 (android)"
    expect(parseAppContext(ua)).toEqual({ platform: "android", version: "1.0.0" })
  })

  it("ios 플랫폼도 인식한다", () => {
    expect(parseAppContext("… AlmondyoungApp/2.3.1 (ios)")).toEqual({
      platform: "ios",
      version: "2.3.1",
    })
  })

  it("일반 브라우저 UA 는 null 을 준다", () => {
    const ua = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36"
    expect(parseAppContext(ua)).toBeNull()
  })

  it("UA 가 없으면 null 을 준다", () => {
    expect(parseAppContext(null)).toBeNull()
    expect(parseAppContext(undefined)).toBeNull()
  })

  it("모르는 플랫폼 문자열은 null 을 준다", () => {
    expect(parseAppContext("… AlmondyoungApp/1.0.0 (windows)")).toBeNull()
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd web/almondyoung-storefront && npx vitest run src/lib/app-context/parse.test.ts`
Expected: FAIL — `Failed to resolve import "./parse"`

- [ ] **Step 3: 구현**

`web/almondyoung-storefront/src/lib/app-context/parse.ts`:

```ts
export type AppContext = { platform: "android" | "ios"; version: string }

export const APP_CONTEXT_HEADER = "x-almondyoung-app"

const UA_PATTERN = /AlmondyoungApp\/(\d+\.\d+\.\d+)\s+\((android|ios)\)/

/** 앱 WebView 가 붙인 UA 접미사를 파싱한다. 앱이 아니면 null. */
export function parseAppContext(
  userAgent: string | null | undefined
): AppContext | null {
  if (!userAgent) return null
  const m = UA_PATTERN.exec(userAgent)
  if (!m) return null
  return { version: m[1], platform: m[2] as AppContext["platform"] }
}

/** 미들웨어가 헤더에 실을 직렬화 형태. */
export function serializeAppContext(ctx: AppContext): string {
  return `${ctx.platform}/${ctx.version}`
}

/** 서버 컴포넌트가 헤더에서 복원하는 형태. */
export function deserializeAppContext(raw: string | null | undefined): AppContext | null {
  if (!raw) return null
  const [platform, version] = raw.split("/")
  if (platform !== "android" && platform !== "ios") return null
  if (!version) return null
  return { platform, version }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd web/almondyoung-storefront && npx vitest run src/lib/app-context/parse.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: 직렬화 왕복 테스트 추가**

`parse.test.ts` 에 추가:

```ts
import { deserializeAppContext, serializeAppContext } from "./parse"

describe("app context 직렬화", () => {
  it("직렬화 후 복원하면 같은 값이 된다", () => {
    const ctx = { platform: "android", version: "1.0.0" } as const
    expect(deserializeAppContext(serializeAppContext(ctx))).toEqual(ctx)
  })

  it("빈 값이나 모르는 플랫폼은 null 이 된다", () => {
    expect(deserializeAppContext(null)).toBeNull()
    expect(deserializeAppContext("windows/1.0.0")).toBeNull()
    expect(deserializeAppContext("android/")).toBeNull()
  })
})
```

Run: `cd web/almondyoung-storefront && npx vitest run src/lib/app-context/parse.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 6: 서버 컴포넌트용 헬퍼 작성**

`web/almondyoung-storefront/src/lib/app-context/server.ts`:

```ts
import "server-only"

import { headers } from "next/headers"

import { APP_CONTEXT_HEADER, AppContext, deserializeAppContext } from "./parse"

/** 서버 컴포넌트에서 앱 컨텍스트를 읽는다. 웹 브라우저면 null. */
export async function getAppContext(): Promise<AppContext | null> {
  const h = await headers()
  return deserializeAppContext(h.get(APP_CONTEXT_HEADER))
}
```

- [ ] **Step 7: 미들웨어 배선**

`web/almondyoung-storefront/src/middleware.ts` 상단 import 에 추가:

```ts
import {
  APP_CONTEXT_HEADER,
  parseAppContext,
  serializeAppContext,
} from "@/lib/app-context/parse"
```

`middleware()` 안에서 `requestHeaders` 를 만드는 두 곳(`urlHasCountryCode && cacheIdCookie` 분기와 `urlHasCountryCode && !cacheIdCookie` 분기) 모두에서, `requestHeaders.set("x-pathname", ...)` 바로 다음 줄에 아래를 넣는다:

```ts
    // requestHeaders 는 클라이언트 요청 헤더의 복사본이므로, 외부에서 실어 보낸
    // APP_CONTEXT_HEADER 를 먼저 지운다. 지우지 않으면 아무나 헤더를 위조해
    // 앱 컨텍스트를 사칭할 수 있고, 이 헤더를 신뢰하는 의미가 사라진다.
    requestHeaders.delete(APP_CONTEXT_HEADER)
    const appContext = parseAppContext(request.headers.get("user-agent"))
    if (appContext) {
      requestHeaders.set(APP_CONTEXT_HEADER, serializeAppContext(appContext))
    }
```

- [ ] **Step 8: 타입 체크**

Run: `cd web/almondyoung-storefront && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "app-context|middleware" || echo "no new errors"`
Expected: `no new errors` (레포 상시 type debt 는 무시하고 변경 파일만 확인한다)

- [ ] **Step 9: 커밋**

```bash
git add web/almondyoung-storefront/src/lib/app-context web/almondyoung-storefront/src/middleware.ts
git commit -m "feat(storefront): 앱 WebView 컨텍스트를 UA 에서 파싱해 서버 컴포넌트에 노출"
```

---

### Task 3: MainWebView — 크롬리스 웹뷰 + 백 제스처

**Files:**
- Create: `native/storefront-app/src/webview/url-policy.ts`
- Create: `native/storefront-app/src/webview/MainWebView.tsx`
- Modify: `native/storefront-app/App.tsx`
- Test: `native/storefront-app/src/webview/url-policy.test.ts`

**Interfaces:**
- Consumes: `appEnv` (Task 1), `buildUserAgentSuffix` (Task 1)
- Produces:
  - `classifyUrl(url: string, internalHosts: string[]): 'internal' | 'external'`
  - `MainWebView` — props `{ initialUrl: string; onExternalUrl: (url: string) => void }`. Task 10 에서 `onBridgeMessage` 가 추가된다
  - `useFocusEffect(effect: () => () => void): void`

- [ ] **Step 1: 실패하는 테스트 작성**

`native/storefront-app/src/webview/url-policy.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { classifyUrl } from "./url-policy"

const HOSTS = ["almondyoung.com", "auth.almondyoung.com"]

describe("classifyUrl", () => {
  it("등록된 호스트는 internal 이다", () => {
    expect(classifyUrl("https://almondyoung.com/kr/cart", HOSTS)).toBe("internal")
  })

  it("서브도메인이라도 목록에 있으면 internal 이다", () => {
    expect(classifyUrl("https://auth.almondyoung.com/oauth/authorize", HOSTS)).toBe("internal")
  })

  it("목록에 없는 호스트는 external 이다", () => {
    expect(classifyUrl("https://pay.toss.im/checkout", HOSTS)).toBe("external")
  })

  it("목록에 없는 서브도메인은 external 이다", () => {
    expect(classifyUrl("https://blog.almondyoung.com.evil.com/", HOSTS)).toBe("external")
  })

  it("파싱 불가 URL 은 external 로 처리한다", () => {
    expect(classifyUrl("not a url", HOSTS)).toBe("external")
  })

  it("http/https 가 아닌 스킴은 external 이다", () => {
    expect(classifyUrl("intent://scan/#Intent;scheme=zxing;end", HOSTS)).toBe("external")
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd native/storefront-app && npx vitest run src/webview/url-policy.test.ts`
Expected: FAIL — `Failed to resolve import "./url-policy"`

- [ ] **Step 3: 구현**

`native/storefront-app/src/webview/url-policy.ts`:

```ts
export type UrlClass = "internal" | "external"

/**
 * 메인 웹뷰에 머무를 URL 인지 판정한다.
 * 외부 도메인(PG 결제창, 정책 링크 등)을 메인 웹뷰에 가두면 히스토리가 꼬여
 * 사용자가 앱에 갇히므로 반드시 분리한다.
 */
export function classifyUrl(url: string, internalHosts: string[]): UrlClass {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return "external"
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "external"
  return internalHosts.includes(parsed.hostname) ? "internal" : "external"
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd native/storefront-app && npx vitest run src/webview/url-policy.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: MainWebView 구현**

`native/storefront-app/src/webview/MainWebView.tsx`:

```tsx
import { useCallback, useRef } from "react"
import { BackHandler, ToastAndroid } from "react-native"
import { WebView, type WebViewNavigation } from "react-native-webview"
import * as Application from "expo-application"
import { useFocusEffect } from "./use-focus-effect"
import { appEnv } from "../config/env"
import { buildUserAgentSuffix } from "../app-context/user-agent"
import { classifyUrl } from "./url-policy"

const INTERNAL_HOSTS = [
  new URL(appEnv.storefrontOrigin).hostname,
  new URL(appEnv.authWebOrigin).hostname,
]

type Props = {
  initialUrl: string
  onExternalUrl: (url: string) => void
}

/** initialUrl 이 바뀌면 react-native-webview 가 해당 URL 로 이동한다. */
export function MainWebView({ initialUrl, onExternalUrl }: Props) {
    const webRef = useRef<WebView>(null)
    const canGoBack = useRef(false)
    const lastBackPress = useRef(0)

    const onBack = useCallback(() => {
      if (canGoBack.current) {
        webRef.current?.goBack()
        return true
      }
      const now = Date.now()
      if (now - lastBackPress.current < 2000) return false // 두 번째 → 앱 종료
      lastBackPress.current = now
      ToastAndroid.show("한 번 더 누르면 종료됩니다", ToastAndroid.SHORT)
      return true
    }, [])

    useFocusEffect(() => {
      const sub = BackHandler.addEventListener("hardwareBackPress", onBack)
      return () => sub.remove()
    })

    return (
      <WebView
        ref={webRef}
        source={{ uri: initialUrl }}
        applicationNameForUserAgent={buildUserAgentSuffix({
          appVersion: Application.nativeApplicationVersion ?? "0.0.0",
          platform: "android",
        })}
        pullToRefreshEnabled
        allowsBackForwardNavigationGestures
        onNavigationStateChange={(nav: WebViewNavigation) => {
          canGoBack.current = nav.canGoBack
        }}
        onShouldStartLoadWithRequest={(req) => {
          if (classifyUrl(req.url, INTERNAL_HOSTS) === "external") {
            onExternalUrl(req.url)
            return false
          }
          return true
        }}
      />
    )
}
```

- [ ] **Step 6: useFocusEffect 헬퍼 작성**

`native/storefront-app/src/webview/use-focus-effect.ts`:

```ts
import { useEffect } from "react"

/** 네비게이션 라이브러리 없이 마운트 동안만 구독을 유지한다. */
export function useFocusEffect(effect: () => () => void): void {
  useEffect(effect, [])
}
```

- [ ] **Step 7: App.tsx 배선**

`native/storefront-app/App.tsx`:

```tsx
import { SafeAreaView, StatusBar, StyleSheet } from "react-native"
import { MainWebView } from "./src/webview/MainWebView"
import { appEnv } from "./src/config/env"

export default function App() {
  const initialUrl = `${appEnv.storefrontOrigin}/${appEnv.defaultCountryCode}`
  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="dark-content" />
      <MainWebView
        initialUrl={initialUrl}
        onExternalUrl={(url) => console.log("external:", url)}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({ root: { flex: 1 } })
```

- [ ] **Step 8: 수동 확인**

Run: `cd native/storefront-app && npx expo run:android`
Expected: 앱이 storefront 홈을 전체화면으로 표시. 웹 하단바가 보이고 앱 크롬은 없음. 상품 상세로 이동 후 시스템 백 → 이전 화면. 홈에서 백 → 종료 토스트

- [ ] **Step 9: 커밋**

```bash
git add native/storefront-app
git commit -m "feat(storefront-app): 크롬리스 메인 웹뷰와 시스템 백 제스처"
```

---

### Task 4: ModalWebView — 외부 도메인 분리

**Files:**
- Create: `native/storefront-app/src/webview/ModalWebView.tsx`
- Modify: `native/storefront-app/App.tsx`

**Interfaces:**
- Consumes: `classifyUrl` (Task 3), `MainWebView` props (Task 3)
- Produces: `ModalWebView` — props `{ url: string | null; onClose: () => void }`

- [ ] **Step 1: ModalWebView 구현**

`native/storefront-app/src/webview/ModalWebView.tsx`:

```tsx
import { Modal, Pressable, SafeAreaView, StyleSheet, Text, View } from "react-native"
import { WebView } from "react-native-webview"

type Props = { url: string | null; onClose: () => void }

/**
 * 외부 도메인 전용 웹뷰. 상단 닫기 바를 둔다 —
 * 외부 사이트에서 히스토리가 꼬여도 사용자가 항상 빠져나올 수 있어야 한다.
 */
export function ModalWebView({ url, onClose }: Props) {
  return (
    <Modal visible={url !== null} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.root}>
        <View style={styles.bar}>
          <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="닫기">
            <Text style={styles.close}>닫기</Text>
          </Pressable>
        </View>
        {url ? <WebView source={{ uri: url }} /> : null}
      </SafeAreaView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  bar: {
    height: 48,
    justifyContent: "center",
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e5e5",
  },
  close: { fontSize: 16, fontWeight: "600" },
})
```

- [ ] **Step 2: App.tsx 에 상태 배선**

`native/storefront-app/App.tsx` 를 아래로 교체:

```tsx
import { useState } from "react"
import { SafeAreaView, StatusBar, StyleSheet } from "react-native"
import { MainWebView } from "./src/webview/MainWebView"
import { ModalWebView } from "./src/webview/ModalWebView"
import { appEnv } from "./src/config/env"

export default function App() {
  const [externalUrl, setExternalUrl] = useState<string | null>(null)
  const initialUrl = `${appEnv.storefrontOrigin}/${appEnv.defaultCountryCode}`

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="dark-content" />
      <MainWebView initialUrl={initialUrl} onExternalUrl={setExternalUrl} />
      <ModalWebView url={externalUrl} onClose={() => setExternalUrl(null)} />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({ root: { flex: 1 } })
```

- [ ] **Step 3: 수동 확인**

Run: `cd native/storefront-app && npx expo run:android`
Expected: 상품 상세 → 결제 진입 시 외부 PG 도메인이 상단 닫기 바가 있는 모달로 열림. 닫기를 누르면 메인 웹뷰로 복귀

- [ ] **Step 4: 커밋**

```bash
git add native/storefront-app
git commit -m "feat(storefront-app): 외부 도메인을 닫기 바가 있는 모달 웹뷰로 분리"
```

---

### Task 5: OAuth 클라이언트 등록 2건

**Files:** 없음 (설정 작업)

**Interfaces:**
- Produces: `EXPO_PUBLIC_APP_OAUTH_CLIENT_ID` 에 넣을 client_id, `medusa-storefront` 의 확장된 redirect_uri 목록

- [ ] **Step 1: 기존 medusa 클라이언트의 현재 redirect_uri 확인**

Run:
```bash
curl -s -H "authorization: Bearer $ADMIN_TOKEN" \
  "$USER_SERVICE_URL/admin/oauth-clients" | jq '.data[] | {clientId, clientType, redirectUris}'
```
Expected: `medusa-storefront` 항목이 보이고 `clientType: "confidential"`

- [ ] **Step 2: medusa-storefront 에 앱 콜백 redirect_uri 추가**

**Step 1 출력의 기존 `redirectUris` 를 그대로 유지한 채** `almondyoung://callback/oidc` 만 덧붙인다. 기존 항목을 하나라도 빠뜨리면 웹 로그인이 즉시 깨지므로, Step 1 의 JSON 을 그대로 이어받아 배열을 만든다.

Run:
```bash
EXISTING=$(curl -s -H "authorization: Bearer $ADMIN_TOKEN" \
  "$USER_SERVICE_URL/admin/oauth-clients" \
  | jq -c '[.data[] | select(.clientId=="medusa-storefront") | .redirectUris[]]')

curl -s -X PATCH -H "authorization: Bearer $ADMIN_TOKEN" -H "content-type: application/json" \
  "$USER_SERVICE_URL/admin/oauth-clients/medusa-storefront" \
  -d "$(jq -nc --argjson e "$EXISTING" \
        '{redirectUris: ($e + ["almondyoung://callback/oidc"] | unique)}')" | jq
```
Expected: 응답의 `redirectUris` 가 기존 항목 + 신규 1건

- [ ] **Step 3: 앱 public client 신규 등록**

Run:
```bash
curl -s -X POST -H "authorization: Bearer $ADMIN_TOKEN" -H "content-type: application/json" \
  "$USER_SERVICE_URL/admin/oauth-clients" \
  -d '{
    "clientId": "almondyoung-android-app",
    "clientType": "public",
    "redirectUris": ["almondyoung://oauth/callback"],
    "allowedScopes": ["openid", "profile", "email"]
  }' | jq
```

- [ ] **Step 4: 등록 검증**

Run:
```bash
curl -s -H "authorization: Bearer $ADMIN_TOKEN" \
  "$USER_SERVICE_URL/admin/oauth-clients" \
  | jq '.data[] | select(.clientId=="medusa-storefront" or .clientId=="almondyoung-android-app") | {clientId, clientType, redirectUris}'
```
Expected: `medusa-storefront.redirectUris` 에 `almondyoung://callback/oidc` 포함, `almondyoung-android-app` 이 `public` 으로 존재

- [ ] **Step 5: 앱 .env 에 client_id 반영**

`native/storefront-app/.env` 에 `EXPO_PUBLIC_APP_OAUTH_CLIENT_ID=almondyoung-android-app` 을 넣는다. `.env` 는 커밋하지 않는다 (`.gitignore` 확인).

- [ ] **Step 6: 커밋**

```bash
git add native/storefront-app/.env.example
git commit -m "chore(storefront-app): OAuth 클라이언트 등록값을 env 예시에 반영"
```

---

### Task 6: login/ 모듈 — 웹뷰 로그인 오케스트레이션

**Files:**
- Create: `native/storefront-app/src/login/authorize.ts`
- Create: `native/storefront-app/src/login/callback.ts`
- Test: `native/storefront-app/src/login/callback.test.ts`

**Interfaces:**
- Consumes: `appEnv` (Task 1)
- Produces:
  - `requestMedusaAuthorizeUrl(deps: { fetch: typeof fetch }): Promise<string>`
  - `parseOidcCallbackParams(url: string): { code: string; state: string } | null`
  - `buildWebviewCallbackUrl(input: { origin: string; countryCode: string; code: string; state: string }): string`
  - `WEBVIEW_LOGIN_REDIRECT = 'almondyoung://callback/oidc'`

- [ ] **Step 1: 실패하는 테스트 작성**

`native/storefront-app/src/login/callback.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { buildWebviewCallbackUrl, parseOidcCallbackParams } from "./callback"

describe("parseOidcCallbackParams", () => {
  it("커스텀 스킴 콜백에서 code 와 state 를 뽑는다", () => {
    expect(parseOidcCallbackParams("almondyoung://callback/oidc?code=abc&state=xyz"))
      .toEqual({ code: "abc", state: "xyz" })
  })

  it("code 가 없으면 null 이다", () => {
    expect(parseOidcCallbackParams("almondyoung://callback/oidc?state=xyz")).toBeNull()
  })

  it("state 가 없으면 null 이다", () => {
    expect(parseOidcCallbackParams("almondyoung://callback/oidc?code=abc")).toBeNull()
  })

  it("IdP 가 error 를 실어 보내면 null 이다", () => {
    expect(
      parseOidcCallbackParams("almondyoung://callback/oidc?error=access_denied"),
    ).toBeNull()
  })

  it("파싱 불가 문자열은 null 이다", () => {
    expect(parseOidcCallbackParams("garbage")).toBeNull()
  })
})

describe("buildWebviewCallbackUrl", () => {
  it("기존 storefront 콜백 라우트 URL 을 만든다", () => {
    expect(
      buildWebviewCallbackUrl({
        origin: "https://almondyoung.com",
        countryCode: "kr",
        code: "abc",
        state: "xyz",
      }),
    ).toBe("https://almondyoung.com/kr/callback/oidc?code=abc&state=xyz")
  })

  it("code 와 state 를 URL 인코딩한다", () => {
    expect(
      buildWebviewCallbackUrl({
        origin: "https://almondyoung.com",
        countryCode: "kr",
        code: "a b+c",
        state: "x/y",
      }),
    ).toBe("https://almondyoung.com/kr/callback/oidc?code=a+b%2Bc&state=x%2Fy")
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd native/storefront-app && npx vitest run src/login/callback.test.ts`
Expected: FAIL — `Failed to resolve import "./callback"`

- [ ] **Step 3: 구현**

`native/storefront-app/src/login/callback.ts`:

```ts
export const WEBVIEW_LOGIN_REDIRECT = "almondyoung://callback/oidc"

/** Custom Tabs 가 돌려준 커스텀 스킴 URL 에서 code·state 를 뽑는다. */
export function parseOidcCallbackParams(
  url: string
): { code: string; state: string } | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.searchParams.get("error")) return null
  const code = parsed.searchParams.get("code")
  const state = parsed.searchParams.get("state")
  if (!code || !state) return null
  return { code, state }
}

/**
 * 기존 storefront OIDC 콜백 라우트 URL.
 * 웹뷰가 이 URL 을 열면 code 를 상환하고 _medusa_jwt + 부모 쿠키가 웹뷰에 심긴다.
 */
export function buildWebviewCallbackUrl(input: {
  origin: string
  countryCode: string
  code: string
  state: string
}): string {
  const params = new URLSearchParams({ code: input.code, state: input.state })
  return `${input.origin}/${input.countryCode}/callback/oidc?${params.toString()}`
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd native/storefront-app && npx vitest run src/login/callback.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: authorize URL 요청 구현**

`native/storefront-app/src/login/authorize.ts`:

```ts
import { appEnv } from "../config/env"
import { WEBVIEW_LOGIN_REDIRECT } from "./callback"

/**
 * Medusa 에 OIDC 흐름 시작을 요청해 authorize URL 을 받는다.
 * storefront 의 startOidcLogin 은 서버 액션이라 redirect() 로 끝나므로 앱이 쓸 수 없다.
 * 대신 같은 Medusa 엔드포인트를 직접 호출한다 — callback_url 만 앱 스킴으로 바꾼다.
 */
export async function requestMedusaAuthorizeUrl(
  deps: { fetch: typeof fetch } = { fetch }
): Promise<string> {
  const res = await deps.fetch(`${appEnv.medusaUrl}/auth/customer/user-service-sso`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-publishable-api-key": appEnv.medusaPublishableKey,
    },
    body: JSON.stringify({ callback_url: WEBVIEW_LOGIN_REDIRECT }),
  })
  if (!res.ok) {
    throw new Error(`authorize 요청 실패: ${res.status} ${await res.text()}`)
  }
  const json = (await res.json()) as { location?: string }
  if (!json.location) throw new Error("authorize 응답에 location 이 없습니다")
  return json.location
}
```

- [ ] **Step 6: 커밋**

```bash
git add native/storefront-app/src/login
git commit -m "feat(storefront-app): 웹뷰 로그인 오케스트레이션 — authorize 요청과 콜백 URL 생성"
```

---

### Task 7: auth/ 모듈 — 앱 자체 PKCE 토큰

**Files:**
- Create: `native/storefront-app/src/auth/token-store.ts`
- Create: `native/storefront-app/src/auth/pkce-login.ts`
- Test: `native/storefront-app/src/auth/token-store.test.ts`

**Interfaces:**
- Consumes: `appEnv` (Task 1)
- Produces:
  - `type StoredTokens = { accessToken: string; refreshToken: string; expiresAt: number }`
  - `createTokenStore(backend: SecureBackend): TokenStore` — `{ read(): Promise<StoredTokens|null>; write(t: StoredTokens): Promise<void>; clear(): Promise<void> }`
  - `type SecureBackend = { getItemAsync(k: string): Promise<string|null>; setItemAsync(k: string, v: string): Promise<void>; deleteItemAsync(k: string): Promise<void> }`
  - `isExpired(tokens: StoredTokens, now: number, skewMs?: number): boolean`
  - `loginWithPkce(): Promise<StoredTokens>`
  - `ensureFreshAccessToken(store: TokenStore): Promise<string | null>`
  - `APP_LOGIN_REDIRECT = 'almondyoung://oauth/callback'`
  - `appEnv.userServiceUrl` (env.ts 에 신규 추가 — §Step 0)

- [ ] **Step 0: user-service URL 을 env 에 추가**

앱의 토큰 엔드포인트는 auth-web 이 아니라 user-service 다 (§Step 5 주석 참고).
`native/storefront-app/src/config/env.ts` 의 `appEnv` 에 추가한다:

```ts
  userServiceUrl: required(
    "EXPO_PUBLIC_USER_SERVICE_URL",
    process.env.EXPO_PUBLIC_USER_SERVICE_URL,
  ),
```

`.env.example` 에 추가: `EXPO_PUBLIC_USER_SERVICE_URL=https://user.almondyoung.com`

- [ ] **Step 1: 실패하는 테스트 작성**

`native/storefront-app/src/auth/token-store.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"
import { createTokenStore, isExpired, type StoredTokens } from "./token-store"

function fakeBackend(initial: Record<string, string> = {}) {
  const data = { ...initial }
  return {
    data,
    getItemAsync: vi.fn(async (k: string) => data[k] ?? null),
    setItemAsync: vi.fn(async (k: string, v: string) => { data[k] = v }),
    deleteItemAsync: vi.fn(async (k: string) => { delete data[k] }),
  }
}

const SAMPLE: StoredTokens = { accessToken: "a", refreshToken: "r", expiresAt: 1000 }

describe("createTokenStore", () => {
  it("쓴 값을 그대로 읽는다", async () => {
    const store = createTokenStore(fakeBackend())
    await store.write(SAMPLE)
    expect(await store.read()).toEqual(SAMPLE)
  })

  it("저장된 값이 없으면 null 이다", async () => {
    expect(await createTokenStore(fakeBackend()).read()).toBeNull()
  })

  it("손상된 JSON 은 null 로 처리한다", async () => {
    const store = createTokenStore(fakeBackend({ "almondyoung.tokens": "{{{" }))
    expect(await store.read()).toBeNull()
  })

  it("clear 후에는 null 이다", async () => {
    const store = createTokenStore(fakeBackend())
    await store.write(SAMPLE)
    await store.clear()
    expect(await store.read()).toBeNull()
  })
})

describe("isExpired", () => {
  it("만료 시각 이후면 만료다", () => {
    expect(isExpired(SAMPLE, 1001, 0)).toBe(true)
  })

  it("여유 시간 안이면 만료로 본다", () => {
    expect(isExpired(SAMPLE, 900, 200)).toBe(true)
  })

  it("여유 시간 밖이면 유효하다", () => {
    expect(isExpired(SAMPLE, 500, 200)).toBe(false)
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd native/storefront-app && npx vitest run src/auth/token-store.test.ts`
Expected: FAIL — `Failed to resolve import "./token-store"`

- [ ] **Step 3: 구현**

`native/storefront-app/src/auth/token-store.ts`:

```ts
export type StoredTokens = {
  accessToken: string
  refreshToken: string
  /** epoch ms */
  expiresAt: number
}

export type SecureBackend = {
  getItemAsync(key: string): Promise<string | null>
  setItemAsync(key: string, value: string): Promise<void>
  deleteItemAsync(key: string): Promise<void>
}

export type TokenStore = {
  read(): Promise<StoredTokens | null>
  write(tokens: StoredTokens): Promise<void>
  clear(): Promise<void>
}

const KEY = "almondyoung.tokens"

export function createTokenStore(backend: SecureBackend): TokenStore {
  return {
    async read() {
      const raw = await backend.getItemAsync(KEY)
      if (!raw) return null
      try {
        return JSON.parse(raw) as StoredTokens
      } catch {
        return null
      }
    },
    async write(tokens) {
      await backend.setItemAsync(KEY, JSON.stringify(tokens))
    },
    async clear() {
      await backend.deleteItemAsync(KEY)
    },
  }
}

const DEFAULT_SKEW_MS = 30_000

export function isExpired(
  tokens: StoredTokens,
  now: number,
  skewMs: number = DEFAULT_SKEW_MS
): boolean {
  return tokens.expiresAt <= now + skewMs
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd native/storefront-app && npx vitest run src/auth/token-store.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: PKCE 로그인 구현**

`native/storefront-app/src/auth/pkce-login.ts`:

```ts
import * as AuthSession from "expo-auth-session"
import { appEnv } from "../config/env"
import type { StoredTokens } from "./token-store"

export const APP_LOGIN_REDIRECT = "almondyoung://oauth/callback"

// authorize 와 token 은 호스트가 다르다.
//   /oauth/authorize   → auth-web (로그인 UI. auth-web 에는 이 페이지와 /oauth/end_session 만 있다)
//   /oauth/token       → user-service (실제 토큰 발급처)
// Medusa 의 user-service-sso 프로바이더도 같은 분리를 쓴다 — authorize 는 authWebUrl,
// exchangeCode 는 issuerUrl(user-service). 둘을 같은 호스트로 묶으면 토큰 교환이 404 로 죽는다.
const discovery: AuthSession.DiscoveryDocument = {
  authorizationEndpoint: `${appEnv.authWebOrigin}/oauth/authorize`,
  tokenEndpoint: `${appEnv.userServiceUrl}/oauth/token`,
}

/**
 * 앱 자신의 public client 로 PKCE authorization_code 흐름을 수행한다.
 * 이 토큰은 이후 네이티브 화면(고객센터 채팅 등)이 쓴다.
 * 웹뷰 세션과는 분리되어 있으며 서로 토큰을 넘기지 않는다.
 */
export async function loginWithPkce(): Promise<StoredTokens> {
  const request = new AuthSession.AuthRequest({
    clientId: appEnv.appClientId,
    redirectUri: APP_LOGIN_REDIRECT,
    scopes: ["openid", "profile", "email"],
    usePKCE: true,
  })

  const result = await request.promptAsync(discovery)
  if (result.type !== "success" || !result.params.code) {
    throw new Error(`앱 로그인 실패: ${result.type}`)
  }

  const token = await AuthSession.exchangeCodeAsync(
    {
      clientId: appEnv.appClientId,
      code: result.params.code,
      redirectUri: APP_LOGIN_REDIRECT,
      extraParams: { code_verifier: request.codeVerifier ?? "" },
    },
    discovery,
  )

  if (!token.accessToken || !token.refreshToken) {
    throw new Error("토큰 응답에 access/refresh 가 없습니다")
  }

  return {
    accessToken: token.accessToken,
    refreshToken: token.refreshToken,
    expiresAt: Date.now() + (token.expiresIn ?? 900) * 1000,
  }
}
```

- [ ] **Step 6: 토큰 갱신 구현**

앱 accessToken 은 15분이라 푸시 등록 시점에 만료돼 있을 수 있다. `pkce-login.ts` 하단에 추가한다:

```ts
import { isExpired, type TokenStore } from "./token-store"

/**
 * 저장된 accessToken 이 유효하면 그대로, 만료됐으면 refreshToken 으로 갱신해 돌려준다.
 * 갱신도 실패하면 null — 호출자는 이 경우 조용히 포기한다 (앱 사용을 막지 않는다).
 */
export async function ensureFreshAccessToken(store: TokenStore): Promise<string | null> {
  const tokens = await store.read()
  if (!tokens) return null
  if (!isExpired(tokens, Date.now())) return tokens.accessToken

  try {
    const refreshed = await AuthSession.refreshAsync(
      { clientId: appEnv.appClientId, refreshToken: tokens.refreshToken },
      discovery,
    )
    if (!refreshed.accessToken) return null
    const next: StoredTokens = {
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken ?? tokens.refreshToken,
      expiresAt: Date.now() + (refreshed.expiresIn ?? 900) * 1000,
    }
    await store.write(next)
    return next.accessToken
  } catch {
    return null
  }
}
```

- [ ] **Step 7: 커밋**

```bash
git add native/storefront-app/src/auth
git commit -m "feat(storefront-app): 앱 자체 PKCE 로그인, SecureStore 보관, 토큰 갱신"
```

---

### Task 8: SplashGate — 로그인 순서 오케스트레이션

**Files:**
- Create: `native/storefront-app/src/session/decide.ts`
- Create: `native/storefront-app/src/session/SplashGate.tsx`
- Modify: `native/storefront-app/App.tsx`
- Test: `native/storefront-app/src/session/decide.test.ts`

**Interfaces:**
- Consumes: `loginWithPkce` `createTokenStore` `StoredTokens` (Task 7), `requestMedusaAuthorizeUrl` `parseOidcCallbackParams` `buildWebviewCallbackUrl` `WEBVIEW_LOGIN_REDIRECT` (Task 6), `appEnv` (Task 1)
- Produces:
  - `decideStartupAction(input: { tokens: StoredTokens | null; now: number }): 'login' | 'skip'`
  - `SplashGate` — props `{ onReady: (initialUrl: string) => void }`

- [ ] **Step 1: 실패하는 테스트 작성**

`native/storefront-app/src/session/decide.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { decideStartupAction } from "./decide"

const NOW = 10_000

describe("decideStartupAction", () => {
  it("토큰이 없으면 로그인한다", () => {
    expect(decideStartupAction({ tokens: null, now: NOW })).toBe("login")
  })

  it("refreshToken 이 살아있으면 건너뛴다", () => {
    expect(
      decideStartupAction({
        tokens: { accessToken: "a", refreshToken: "r", expiresAt: NOW + 600_000 },
        now: NOW,
      }),
    ).toBe("skip")
  })

  it("accessToken 이 만료돼도 refreshToken 이 있으면 건너뛴다", () => {
    expect(
      decideStartupAction({
        tokens: { accessToken: "a", refreshToken: "r", expiresAt: NOW - 1 },
        now: NOW,
      }),
    ).toBe("skip")
  })

  it("refreshToken 이 비어 있으면 로그인한다", () => {
    expect(
      decideStartupAction({
        tokens: { accessToken: "a", refreshToken: "", expiresAt: NOW + 600_000 },
        now: NOW,
      }),
    ).toBe("login")
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd native/storefront-app && npx vitest run src/session/decide.test.ts`
Expected: FAIL — `Failed to resolve import "./decide"`

- [ ] **Step 3: 구현**

`native/storefront-app/src/session/decide.ts`:

```ts
import type { StoredTokens } from "../auth/token-store"

/**
 * 콜드스타트에 로그인 흐름을 실행할지 판단한다.
 * refreshToken 만 있으면 웹뷰 쿠키가 살아있을 가능성이 높으므로 건너뛰고,
 * 실제로 죽어 있으면 웹이 로그인 화면을 보여준다 (앱이 갇히지 않는다).
 */
export function decideStartupAction(input: {
  tokens: StoredTokens | null
  now: number
}): "login" | "skip" {
  if (!input.tokens) return "login"
  if (!input.tokens.refreshToken) return "login"
  return "skip"
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd native/storefront-app && npx vitest run src/session/decide.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: SplashGate 구현**

`native/storefront-app/src/session/SplashGate.tsx`:

```tsx
import { useEffect, useState } from "react"
import { ActivityIndicator, StyleSheet, View } from "react-native"
import * as SecureStore from "expo-secure-store"
import * as WebBrowser from "expo-web-browser"
import { createTokenStore } from "../auth/token-store"
import { loginWithPkce } from "../auth/pkce-login"
import { requestMedusaAuthorizeUrl } from "../login/authorize"
import {
  WEBVIEW_LOGIN_REDIRECT,
  buildWebviewCallbackUrl,
  parseOidcCallbackParams,
} from "../login/callback"
import { appEnv } from "../config/env"
import { decideStartupAction } from "./decide"

const store = createTokenStore(SecureStore)
const HOME_URL = `${appEnv.storefrontOrigin}/${appEnv.defaultCountryCode}`

/**
 * 순서가 중요하다: 앱 PKCE 로그인을 먼저 해서 Custom Tabs 에 IdP 세션을 만들고,
 * 이어지는 웹뷰 로그인 authorize 는 그 세션을 만나 무음으로 끝난다.
 * 사용자에게 보이는 로그인은 한 번뿐이다.
 */
export function SplashGate({ onReady }: { onReady: (url: string) => void }) {
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function run() {
      try {
        const tokens = await store.read()
        if (decideStartupAction({ tokens, now: Date.now() }) === "skip") {
          if (!cancelled) onReady(HOME_URL)
          return
        }

        // 1) 앱 자체 토큰 — 여기서 사용자가 실제로 로그인한다
        const fresh = await loginWithPkce()
        await store.write(fresh)

        // 2) 웹뷰 세션 — IdP 세션이 생겼으므로 무음으로 끝난다
        const authorizeUrl = await requestMedusaAuthorizeUrl()
        const result = await WebBrowser.openAuthSessionAsync(
          authorizeUrl,
          WEBVIEW_LOGIN_REDIRECT,
        )
        if (result.type !== "success") {
          if (!cancelled) onReady(HOME_URL)
          return
        }
        const params = parseOidcCallbackParams(result.url)
        if (!params) {
          if (!cancelled) onReady(HOME_URL)
          return
        }

        if (!cancelled) {
          onReady(
            buildWebviewCallbackUrl({
              origin: appEnv.storefrontOrigin,
              countryCode: appEnv.defaultCountryCode,
              ...params,
            }),
          )
        }
      } catch {
        // 로그인 실패로 앱이 갇히면 안 된다 — 비로그인 상태로 진입시킨다
        if (!cancelled) {
          setFailed(true)
          onReady(HOME_URL)
        }
      }
    }

    run()
    return () => { cancelled = true }
  }, [onReady])

  return (
    <View style={styles.root} accessibilityLabel={failed ? "로그인 실패" : "준비 중"}>
      <ActivityIndicator size="large" />
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: "center", justifyContent: "center" },
})
```

- [ ] **Step 6: App.tsx 배선**

`native/storefront-app/App.tsx` 를 아래로 교체:

```tsx
import { useCallback, useState } from "react"
import { SafeAreaView, StatusBar, StyleSheet } from "react-native"
import { MainWebView } from "./src/webview/MainWebView"
import { ModalWebView } from "./src/webview/ModalWebView"
import { SplashGate } from "./src/session/SplashGate"

export default function App() {
  const [initialUrl, setInitialUrl] = useState<string | null>(null)
  const [externalUrl, setExternalUrl] = useState<string | null>(null)
  const onReady = useCallback((url: string) => setInitialUrl(url), [])

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="dark-content" />
      {initialUrl === null ? (
        <SplashGate onReady={onReady} />
      ) : (
        <>
          <MainWebView initialUrl={initialUrl} onExternalUrl={setExternalUrl} />
          <ModalWebView url={externalUrl} onClose={() => setExternalUrl(null)} />
        </>
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({ root: { flex: 1 } })
```

- [ ] **Step 7: 수동 확인 — 로그인 왕복**

Run: `cd native/storefront-app && npx expo run:android`
Expected:
1. 앱 첫 실행 → Custom Tabs 로 로그인 화면. 카카오 로그인 정상 동작
2. 로그인 완료 후 Custom Tabs 가 한 번 더 잠깐 떴다 닫힘 (무음 authorize)
3. 웹뷰가 뜨고 **로그인된 상태**. 마이페이지 진입 가능, 장바구니 연결됨
4. 앱 종료 후 재실행 → 로그인 화면 없이 바로 웹뷰

- [ ] **Step 8: 커밋**

```bash
git add native/storefront-app
git commit -m "feat(storefront-app): SplashGate — 앱 토큰 획득 후 웹뷰 세션 부트스트랩"
```

---

### Task 9: push/ 모듈 — FCM 토큰 등록

**Files:**
- Create: `native/storefront-app/src/push/registration.ts`
- Create: `native/storefront-app/src/push/use-push.ts`
- Modify: `native/storefront-app/App.tsx`
- Test: `native/storefront-app/src/push/registration.test.ts`

**Interfaces:**
- Consumes: `createTokenStore` `ensureFreshAccessToken` (Task 7), `appEnv` (Task 1)
- Produces:
  - `buildRegistrationPayload(input: DeviceInfo): RegisterFcmTokenBody`
  - `type RegisterFcmTokenBody = { token: string; platform: 'android'|'ios'; deviceId?: string; deviceModel?: string; deviceName?: string }`
  - `type PushDeps = { fetch: typeof fetch; baseUrl: string }`
  - `registerFcmToken(deps: PushDeps, input: { accessToken: string; payload: RegisterFcmTokenBody }): Promise<void>`
  - `deactivateFcmToken(deps: PushDeps, input: { accessToken: string; token: string }): Promise<void>`
  - `usePushRegistration(ready: boolean): void`

- [ ] **Step 1: 실패하는 테스트 작성**

`native/storefront-app/src/push/registration.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"
import { buildRegistrationPayload, registerFcmToken } from "./registration"

describe("buildRegistrationPayload", () => {
  it("서버 DTO 형태로 맞춘다", () => {
    expect(
      buildRegistrationPayload({
        token: "fcm-abc",
        deviceId: "inst-1",
        deviceModel: "Pixel 8",
        deviceName: "내 폰",
      }),
    ).toEqual({
      token: "fcm-abc",
      platform: "android",
      deviceId: "inst-1",
      deviceModel: "Pixel 8",
      deviceName: "내 폰",
    })
  })

  it("선택 필드가 없으면 키를 넣지 않는다", () => {
    expect(buildRegistrationPayload({ token: "fcm-abc" })).toEqual({
      token: "fcm-abc",
      platform: "android",
    })
  })
})

describe("registerFcmToken", () => {
  it("Bearer 토큰과 함께 POST 한다", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 201 }))
    await registerFcmToken(
      { fetch: fetchMock as unknown as typeof fetch, baseUrl: "https://notif.test" },
      { accessToken: "at", payload: { token: "fcm-abc", platform: "android" } },
    )
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://notif.test/devices/fcm-token")
    expect(init.method).toBe("POST")
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer at")
  })

  it("서버가 실패하면 throw 한다", async () => {
    const fetchMock = vi.fn(async () => new Response("nope", { status: 401 }))
    await expect(
      registerFcmToken(
        { fetch: fetchMock as unknown as typeof fetch, baseUrl: "https://notif.test" },
        { accessToken: "at", payload: { token: "fcm-abc", platform: "android" } },
      ),
    ).rejects.toThrow(/401/)
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd native/storefront-app && npx vitest run src/push/registration.test.ts`
Expected: FAIL — `Failed to resolve import "./registration"`

- [ ] **Step 3: 구현**

`native/storefront-app/src/push/registration.ts`:

```ts
export type RegisterFcmTokenBody = {
  token: string
  platform: "android" | "ios"
  deviceId?: string
  deviceModel?: string
  deviceName?: string
}

export type DeviceInfo = {
  token: string
  deviceId?: string
  deviceModel?: string
  deviceName?: string
}

export type PushDeps = { fetch: typeof fetch; baseUrl: string }

/** notification 서비스의 RegisterFcmTokenDto 에 맞춘 payload. */
export function buildRegistrationPayload(input: DeviceInfo): RegisterFcmTokenBody {
  return {
    token: input.token,
    platform: "android",
    ...(input.deviceId ? { deviceId: input.deviceId } : {}),
    ...(input.deviceModel ? { deviceModel: input.deviceModel } : {}),
    ...(input.deviceName ? { deviceName: input.deviceName } : {}),
  }
}

async function call(
  deps: PushDeps,
  method: "POST" | "DELETE",
  accessToken: string,
  body: unknown,
): Promise<void> {
  const res = await deps.fetch(`${deps.baseUrl}/devices/fcm-token`, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    throw new Error(`fcm-token ${method} 실패: ${res.status} ${await res.text()}`)
  }
}

export function registerFcmToken(
  deps: PushDeps,
  input: { accessToken: string; payload: RegisterFcmTokenBody },
): Promise<void> {
  return call(deps, "POST", input.accessToken, input.payload)
}

export function deactivateFcmToken(
  deps: PushDeps,
  input: { accessToken: string; token: string },
): Promise<void> {
  return call(deps, "DELETE", input.accessToken, { token: input.token })
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd native/storefront-app && npx vitest run src/push/registration.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: notification base URL 을 env 에 추가**

`native/storefront-app/src/config/env.ts` 의 `appEnv` 에 추가:

```ts
  notificationUrl: required(
    "EXPO_PUBLIC_NOTIFICATION_URL",
    process.env.EXPO_PUBLIC_NOTIFICATION_URL,
  ),
```

`.env.example` 에 추가: `EXPO_PUBLIC_NOTIFICATION_URL=https://notification.almondyoung.com`

- [ ] **Step 6: 훅 구현**

`native/storefront-app/src/push/use-push.ts`:

```ts
import { useEffect } from "react"
import { AppState } from "react-native"
import * as Notifications from "expo-notifications"
import * as Application from "expo-application"
import * as Device from "expo-device"
import * as SecureStore from "expo-secure-store"
import { appEnv } from "../config/env"
import { createTokenStore } from "../auth/token-store"
import { ensureFreshAccessToken } from "../auth/pkce-login"
import { buildRegistrationPayload, registerFcmToken } from "./registration"

const deps = { fetch, baseUrl: appEnv.notificationUrl }
const store = createTokenStore(SecureStore)

/**
 * 로그인 이후에만 등록한다 — fcm_tokens.userId 가 필수라 익명 상태에서는 등록할 수 없다.
 * 포그라운드 복귀마다 재등록(upsert)해 lastUsedAt 을 갱신한다.
 * `ready` 는 SplashGate 통과 여부 — 로그인 흐름이 끝난 뒤에만 실행한다.
 */
export function usePushRegistration(ready: boolean): void {
  useEffect(() => {
    if (!ready) return
    let cancelled = false

    async function sync() {
      try {
        const accessToken = await ensureFreshAccessToken(store)
        if (!accessToken || cancelled) return
        const perm = await Notifications.requestPermissionsAsync()
        if (!perm.granted || cancelled) return
        const devicePushToken = await Notifications.getDevicePushTokenAsync()
        if (cancelled) return
        await registerFcmToken(deps, {
          accessToken,
          payload: buildRegistrationPayload({
            token: String(devicePushToken.data),
            deviceId: Application.getAndroidId() ?? undefined,
            deviceModel: Device.modelName ?? undefined,
            deviceName: Device.deviceName ?? undefined,
          }),
        })
      } catch {
        // 푸시 등록 실패가 앱 사용을 막아서는 안 된다
      }
    }

    sync()
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") sync()
    })
    return () => { cancelled = true; sub.remove() }
  }, [ready])
}
```

- [ ] **Step 7: App.tsx 에 훅 호출과 알림 탭 라우팅 배선**

`native/storefront-app/App.tsx` 의 `App` 안, `onReady` 선언 뒤에 추가한다. **훅 호출을 빠뜨리면 토큰이 서버에 등록되지 않는다.**

```tsx
  usePushRegistration(initialUrl !== null)

  // 로그인 완료 전에 도착한 탭 경로를 담아둔다. initialUrl 을 바로 세우면
  // SplashGate 가 언마운트되어 진행 중인 PKCE 흐름이 중단된다.
  const pendingPath = useRef<string | null>(null)

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const path = response.notification.request.content.data?.path
      if (typeof path !== "string" || !path.startsWith("/")) return
      if (initialUrlRef.current === null) {
        pendingPath.current = path   // 아직 로그인 중 — SplashGate 가 소비한다
        return
      }
      setInitialUrl(`${appEnv.storefrontOrigin}${path}`)
    })
    return () => sub.remove()
  }, [])
```

`initialUrlRef` 는 `initialUrl` 을 미러링하는 ref 다 — 리스너가 빈 deps 로 한 번만 등록되므로
클로저가 초기값에 고정되는 것을 피한다.

`SplashGate` 는 `pendingPath` 를 받아 소비한다. 이미 로그인돼 있어 건너뛰는 경로면 그 경로로 바로
진입하고, 로그인을 수행하는 경로면 **`redirect_to` 로 콜백 URL 에 실어** 세션을 심은 뒤 이동하게
한다. storefront 콜백 라우트가 `redirect_to` 를 이미 지원하며 `toLocalizedPath` 가 외부 URL 을
차단하므로 오픈 리다이렉트가 되지 않는다.

따라서 `buildWebviewCallbackUrl` (Task 6) 에 선택 인자 `redirectTo?: string` 을 추가하고, 값이
있을 때만 쿼리에 넣는다.

파일 상단 import 를 갱신한다 (`useCallback` `useState` 는 이미 있다):

```tsx
import { useCallback, useEffect, useState } from "react"
import * as Notifications from "expo-notifications"
import { appEnv } from "./src/config/env"
import { usePushRegistration } from "./src/push/use-push"
```

- [ ] **Step 8: Firebase 설정 파일 배치**

기존 Firebase 프로젝트에 Android 앱(`com.almondyoung.storefront`)을 추가하고 `google-services.json` 을 `native/storefront-app/` 에 넣는다. `app.config.ts` 의 `android` 에 추가:

```ts
    googleServicesFile: "./google-services.json",
```

`.gitignore` 에 `google-services.json` 을 추가한다.

- [ ] **Step 9: 수동 확인**

Run: `cd native/storefront-app && npx expo run:android`
Expected: 로그인 후 알림 권한 다이얼로그. 허용하면 서버 `fcm_tokens` 에 행이 생김. 확인:

```bash
curl -s -X POST "$NOTIFICATION_URL/notifications/send" -H "content-type: application/json" \
  -d '{"userId":"<테스트 userId>","channels":["PUSH"],"content":{"PUSH":{"subject":"테스트","body":"푸시 확인"}}}'
```
Expected: 기기에 알림 수신, 탭하면 앱이 열림

- [ ] **Step 10: 커밋**

```bash
git add native/storefront-app
git commit -m "feat(storefront-app): FCM 토큰 등록과 알림 탭 라우팅"
```

---

### Task 10: 로그아웃 브릿지

**Files:**
- Create: `native/storefront-app/src/bridge/messages.ts`
- Modify: `native/storefront-app/src/webview/MainWebView.tsx`
- Modify: `native/storefront-app/App.tsx`
- Modify: `web/almondyoung-storefront/src/lib/api/users/signout.ts`
- Test: `native/storefront-app/src/bridge/messages.test.ts`

**Interfaces:**
- Consumes: `createTokenStore` `ensureFreshAccessToken` (Task 7), `deactivateFcmToken` (Task 9), `MainWebView` (Task 3)
- Produces:
  - `parseBridgeMessage(raw: string): BridgeMessage | null`
  - `type BridgeMessage = { type: 'auth/logout' }`

- [ ] **Step 1: 실패하는 테스트 작성**

`native/storefront-app/src/bridge/messages.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { parseBridgeMessage } from "./messages"

describe("parseBridgeMessage", () => {
  it("로그아웃 메시지를 인식한다", () => {
    expect(parseBridgeMessage('{"type":"auth/logout"}')).toEqual({ type: "auth/logout" })
  })

  it("모르는 type 은 무시한다", () => {
    expect(parseBridgeMessage('{"type":"cart/updated"}')).toBeNull()
  })

  it("JSON 이 아니면 무시한다", () => {
    expect(parseBridgeMessage("hello")).toBeNull()
  })

  it("type 이 없으면 무시한다", () => {
    expect(parseBridgeMessage('{"foo":1}')).toBeNull()
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd native/storefront-app && npx vitest run src/bridge/messages.test.ts`
Expected: FAIL — `Failed to resolve import "./messages"`

- [ ] **Step 3: 구현**

`native/storefront-app/src/bridge/messages.ts`:

```ts
export type BridgeMessage = { type: "auth/logout" }

const KNOWN_TYPES = new Set(["auth/logout"])

/**
 * 웹→앱 브릿지 메시지. 앱과 웹의 배포 시점이 다르므로 모르는 type 은 조용히 무시한다.
 * 세션 토큰은 절대 이 경로로 오가지 않는다 — 상태 통지 전용이다.
 */
export function parseBridgeMessage(raw: string): BridgeMessage | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== "object" || parsed === null) return null
  const type = (parsed as { type?: unknown }).type
  if (typeof type !== "string" || !KNOWN_TYPES.has(type)) return null
  return { type: type as BridgeMessage["type"] }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd native/storefront-app && npx vitest run src/bridge/messages.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: MainWebView 에 onMessage 배선**

`native/storefront-app/src/webview/MainWebView.tsx` 의 `Props` 에 `onBridgeMessage: (m: BridgeMessage) => void` 를 추가하고, `<WebView>` 에 아래 prop 을 추가한다:

```tsx
        onMessage={(e) => {
          const msg = parseBridgeMessage(e.nativeEvent.data)
          if (msg) onBridgeMessage(msg)
        }}
```

import 추가:

```tsx
import { parseBridgeMessage, type BridgeMessage } from "../bridge/messages"
```

- [ ] **Step 6: App.tsx 에서 로그아웃 처리**

`App.tsx` 에 핸들러를 추가하고 `MainWebView` 에 넘긴다:

```tsx
  const onBridgeMessage = useCallback(async (msg: BridgeMessage) => {
    if (msg.type !== "auth/logout") return
    try {
      const accessToken = await ensureFreshAccessToken(store)
      if (accessToken) {
        const t = await Notifications.getDevicePushTokenAsync()
        await deactivateFcmToken(
          { fetch, baseUrl: appEnv.notificationUrl },
          { accessToken, token: String(t.data) },
        )
      }
    } catch {
      // 비활성화 실패는 무시 — 로컬 토큰 정리는 계속한다
    }
    await store.clear()
    setInitialUrl(null) // SplashGate 로 복귀
  }, [])
```

그리고 `MainWebView` 호출에 새 prop 을 넘긴다:

```tsx
          <MainWebView
            initialUrl={initialUrl}
            onExternalUrl={setExternalUrl}
            onBridgeMessage={onBridgeMessage}
          />
```

파일 상단에 필요한 import 를 추가한다:

```tsx
import * as SecureStore from "expo-secure-store"
import { createTokenStore } from "./src/auth/token-store"
import { ensureFreshAccessToken } from "./src/auth/pkce-login"
import { deactivateFcmToken } from "./src/push/registration"
import type { BridgeMessage } from "./src/bridge/messages"

const store = createTokenStore(SecureStore)
```

- [ ] **Step 7: storefront 에서 메시지 발신**

`web/almondyoung-storefront/src/lib/api/users/signout.ts` 는 서버 액션이라 `window` 에 접근할 수 없다. 대신 클라이언트에서 발신한다. `src/lib/app-context/notify-app.ts` 를 새로 만든다:

```ts
"use client"

/** 앱 웹뷰일 때만 앱에 상태를 통지한다. 웹 브라우저에서는 아무 일도 없다. */
export function notifyAppLogout(): void {
  const bridge = (window as unknown as {
    ReactNativeWebView?: { postMessage: (m: string) => void }
  }).ReactNativeWebView
  bridge?.postMessage(JSON.stringify({ type: "auth/logout" }))
}
```

호출 지점은 두 곳이며 둘 다 이미 `"use client"` 다. 각각 `await signout()` **바로 앞 줄**에 `notifyAppLogout()` 을 넣는다.

- `src/components/layout/header/main-header/user-info.tsx:32`
- `src/domains/mypage/components/mobile/menu-list.tsx:25`

두 파일 모두 상단에 import 를 추가한다:

```ts
import { notifyAppLogout } from "@/lib/app-context/notify-app"
```

수정 후 두 곳 모두 반영됐는지 확인한다.

Run: `cd web/almondyoung-storefront && grep -rn "notifyAppLogout" src/ --include="*.tsx"`
Expected: 2건

- [ ] **Step 8: 수동 확인**

Expected: 웹뷰에서 로그아웃 → 앱이 SplashGate 로 돌아가고 재로그인 화면. 로그아웃 후 테스트 푸시를 보내면 기기에 오지 않음

- [ ] **Step 9: 커밋**

```bash
git add native/storefront-app web/almondyoung-storefront/src/lib/app-context
git commit -m "feat(storefront-app,storefront): 로그아웃 브릿지 — 앱 토큰 정리와 FCM 토큰 비활성화"
```

---

### Task 11: 오류 처리 — 오프라인 화면과 웹뷰 프로세스 복구

**Files:**
- Create: `native/storefront-app/src/webview/ErrorScreen.tsx`
- Modify: `native/storefront-app/src/webview/MainWebView.tsx`

**Interfaces:**
- Consumes: `MainWebView` (Task 3)
- Produces: `ErrorScreen` — props `{ onRetry: () => void }`

- [ ] **Step 1: ErrorScreen 구현**

`native/storefront-app/src/webview/ErrorScreen.tsx`:

```tsx
import { Pressable, StyleSheet, Text, View } from "react-native"

export function ErrorScreen({ onRetry }: { onRetry: () => void }) {
  return (
    <View style={styles.root}>
      <Text style={styles.title}>연결할 수 없습니다</Text>
      <Text style={styles.body}>네트워크 상태를 확인한 뒤 다시 시도해 주세요.</Text>
      <Pressable style={styles.button} onPress={onRetry} accessibilityRole="button">
        <Text style={styles.buttonText}>다시 시도</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  title: { fontSize: 18, fontWeight: "600" },
  body: { marginTop: 8, fontSize: 14, color: "#666", textAlign: "center" },
  button: {
    marginTop: 24,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: "#111",
  },
  buttonText: { color: "#fff", fontSize: 15, fontWeight: "600" },
})
```

- [ ] **Step 2: MainWebView 에 오류 상태 배선**

`MainWebView.tsx` 안에 상태를 추가한다:

```tsx
    const [loadFailed, setLoadFailed] = useState(false)
```

`<WebView>` 에 아래 prop 들을 추가한다:

```tsx
        onError={() => setLoadFailed(true)}
        onHttpError={(e) => {
          if (e.nativeEvent.statusCode >= 500) setLoadFailed(true)
        }}
        onRenderProcessGone={() => {
          // Android WebView 프로세스가 죽으면 재생성하지 않는 한 앱이 통째로 멈춘다
          setLoadFailed(true)
        }}
```

렌더를 아래로 감싼다:

```tsx
    if (loadFailed) {
      return (
        <ErrorScreen
          onRetry={() => {
            setLoadFailed(false)
            webRef.current?.reload()
          }}
        />
      )
    }
```

import 를 추가한다:

```tsx
import { useState } from "react"
import { ErrorScreen } from "./ErrorScreen"
```

- [ ] **Step 3: 수동 확인**

Expected: 비행기 모드에서 앱 실행 → 브라우저 기본 오류 페이지가 아니라 네이티브 오류 화면. 네트워크 복구 후 "다시 시도" → 정상 로드

- [ ] **Step 4: 커밋**

```bash
git add native/storefront-app
git commit -m "feat(storefront-app): 네이티브 오류 화면과 웹뷰 프로세스 종료 복구"
```

---

### Task 12: EAS 빌드와 내부 배포

**Files:**
- Create: `native/storefront-app/eas.json`
- Create: `native/storefront-app/SMOKE.md`

**Interfaces:**
- Consumes: 앞선 모든 태스크

- [ ] **Step 1: EAS 설정**

Run: `cd native/storefront-app && npx eas-cli@latest init`

`native/storefront-app/eas.json`:

```json
{
  "cli": { "version": ">= 12.0.0" },
  "build": {
    "preview": {
      "channel": "preview",
      "android": { "buildType": "apk" },
      "distribution": "internal"
    },
    "production": {
      "channel": "production",
      "android": { "buildType": "app-bundle" }
    }
  },
  "submit": {
    "production": {
      "android": { "track": "internal" }
    }
  }
}
```

- [ ] **Step 2: 내부 테스트 빌드**

Run: `cd native/storefront-app && npx eas-cli build --platform android --profile preview`
Expected: 빌드 성공, APK 다운로드 링크 발급

- [ ] **Step 3: 스모크 체크리스트 작성**

`native/storefront-app/SMOKE.md`:

```markdown
# 수동 스모크 체크리스트

빌드마다 실기기에서 확인한다. 웹뷰 상호작용은 자동 테스트 대상이 아니다.

## 탐색
- [ ] 앱 실행 → storefront 홈이 전체화면. 앱 크롬 없음. 웹 하단바만 보임
- [ ] 하단바가 홈 인디케이터를 침범하지 않음 (safe-area)
- [ ] 상품 상세 진입 → 시스템 백 → 이전 화면
- [ ] 홈에서 백 → "한 번 더 누르면 종료" 토스트 → 두 번째 백에 종료
- [ ] 아래로 당기기 → 새로고침

## 외부 도메인
- [ ] 결제 진입 → 상단 닫기 바가 있는 모달로 열림
- [ ] 모달에서 닫기 → 메인 웹뷰로 복귀. 히스토리 정상

## 로그인
- [ ] 첫 실행 → Custom Tabs 로그인. 카카오 로그인 동작
- [ ] 로그인 후 웹뷰가 로그인 상태 (마이페이지 진입 가능)
- [ ] 장바구니가 계정에 연결됨
- [ ] 앱 재실행 → 로그인 화면 없이 바로 진입
- [ ] 신규 계정으로 가입 → customer 자동 생성 확인
- [ ] 로그아웃 → SplashGate 복귀

## 푸시
- [ ] 로그인 후 알림 권한 요청
- [ ] 테스트 푸시 수신
- [ ] 알림 탭 → 해당 경로로 웹뷰 이동
- [ ] 로그아웃 후 푸시가 오지 않음

## 오류
- [ ] 비행기 모드 실행 → 네이티브 오류 화면 (브라우저 오류 페이지 아님)
- [ ] 네트워크 복구 후 다시 시도 → 정상
```

- [ ] **Step 4: 전체 단위 테스트 실행**

Run: `cd native/storefront-app && npx vitest run`
Expected: PASS — 모든 테스트 통과

- [ ] **Step 5: 커밋**

```bash
git add native/storefront-app/eas.json native/storefront-app/SMOKE.md
git commit -m "chore(storefront-app): EAS 빌드 프로파일과 스모크 체크리스트"
```

---

## 스펙 커버리지

| 스펙 | 태스크 |
|---|---|
| §5 Expo 프레임워크 | 1 |
| §6 크롬리스 웹뷰 + 백 제스처 | 3 |
| §6.2 외부 도메인 모달 분리 | 4 |
| §7.3 웹뷰가 code 상환 | 5, 6, 8 |
| §7.4 앱 자체 PKCE | 5, 7, 8 |
| §7.5 자동 로그인 | 8 |
| §7.6 로그아웃 | 10 |
| §8 앱 컨텍스트 주입 | 1, 2 |
| §9.1 푸시 앱 측 | 9 |
| §10 오류 처리 | 8(로그인 실패), 11 |
| §11 코드 배치·모듈 | 1, 3, 6, 7, 9, 10 |
| §12 테스트 | 각 태스크 + 12 |
| §13 배포 | 5, 12 |

**계획 B(별도):** §9.2 `GET /devices/app-users` + admin-web 푸시 캠페인 화면
