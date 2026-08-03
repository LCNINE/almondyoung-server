import { useEffect } from "react"
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
export function SplashGate({
  onReady,
  pendingPath,
}: {
  onReady: (url: string) => void
  /**
   * 로그인 흐름이 끝나기 전에 알림을 탭해 도착한 경로(App.tsx 가 채운다).
   * 이 흐름이 실제로 그 값을 쓰는 지점(스킵 분기, 콜백 URL 조립)에서
   * `.current` 를 직접 읽는다 — 로그인은 비동기로 오래 걸리므로 마운트
   * 시점의 스냅샷이 아니라 그 시점의 최신값이어야 한다.
   */
  pendingPath: { current: string | null }
}) {
  useEffect(() => {
    let cancelled = false

    async function run() {
      // 각 await 직후 cancelled 를 확인하고, 통과한 다음부터 다음 await 전까지는
      // 동기 코드뿐이라 그 사이에 cancelled 가 바뀔 수 없다 — 그래서 이 지점을
      // 지나면 이어지는 onReady 호출에는 별도 가드가 필요 없다. 이 체크가 없으면
      // (예: Fast Refresh 로 이 effect 가 언마운트→재마운트될 때) 낡은 run() 이
      // 계속 실행되며 store.write, requestMedusaAuthorizeUrl,
      // openAuthSessionAsync 를 그대로 불러버린다 — 특히 이미 취소된 흐름이 실제
      // Custom Tabs 로그인 창을 한 번 더 띄우는 사고로 이어진다.
      let stage = "read-tokens"
      try {
        const tokens = await store.read()
        if (cancelled) return
        if (decideStartupAction({ tokens, now: Date.now() }) === "skip") {
          // 이미 로그인돼 있어 웹뷰 로그인 자체를 건너뛰는 경로 — 대기 중인
          // 탭 경로가 있으면 홈 대신 그 경로로 바로 진입한다.
          const path = pendingPath.current
          // 소비 시점에 바로 비운다 — 로그아웃으로 SplashGate 가 다시 마운트될 때
          // 이전 세션의 경로가 새 세션으로 새어 들어가는 것을 막는다.
          pendingPath.current = null
          onReady(path ? `${appEnv.storefrontOrigin}${path}` : HOME_URL)
          return
        }

        // 1) 앱 자체 토큰 — 여기서 사용자가 실제로 로그인한다
        stage = "pkce-login"
        const fresh = await loginWithPkce()
        if (cancelled) return

        stage = "write-tokens"
        await store.write(fresh)
        if (cancelled) return

        // 2) 웹뷰 세션 — IdP 세션이 생겼으므로 무음으로 끝난다
        stage = "medusa-authorize"
        const authorizeUrl = await requestMedusaAuthorizeUrl()
        if (cancelled) return

        stage = "webview-auth-session"
        const result = await WebBrowser.openAuthSessionAsync(
          authorizeUrl,
          WEBVIEW_LOGIN_REDIRECT,
        )
        if (cancelled) return
        if (result.type !== "success") {
          // result.type 은 'cancel'/'dismiss'/'opened'/'locked' 같은 분류값일 뿐
          // 자격증명이 아니다 — code/state/URL 은 여기 없다.
          console.warn(`[SplashGate] 웹뷰 로그인 세션 실패: stage=${stage} type=${result.type}`)
          onReady(HOME_URL)
          return
        }

        stage = "parse-callback"
        const params = parseOidcCallbackParams(result.url)
        if (!params) {
          // result.url 자체는 code/state 를 담고 있으므로 로그하지 않는다.
          console.warn(`[SplashGate] 콜백 URL 파싱 실패: stage=${stage}`)
          onReady(HOME_URL)
          return
        }

        // 로그인 경로 — 세션을 먼저 심고, 대기 중인 탭 경로가 있으면
        // redirect_to 로 실어 storefront 콜백 라우트가 로그인 후 그 경로로
        // 이동시키게 한다(toLocalizedPath 가 외부 URL 을 막아준다).
        // 소비 시점에 바로 비운다 — 이유는 위 skip 분기와 동일.
        const redirectTo = pendingPath.current
        pendingPath.current = null
        onReady(
          buildWebviewCallbackUrl({
            origin: appEnv.storefrontOrigin,
            countryCode: appEnv.defaultCountryCode,
            ...params,
            ...(redirectTo ? { redirectTo } : {}),
          }),
        )
      } catch (error) {
        // 로그인 실패로 앱이 갇히면 안 된다 — 비로그인 상태로 진입시킨다.
        // 이 catch 가 실행되는 즉시 onReady 로 initialUrl 이 채워져 App.tsx 가
        // SplashGate 를 언마운트하므로("실패" 프레임은 렌더될 기회가 없다 —
        // React 19 자동 배칭이 이 상태 갱신과 부모의 언마운트를 한 커밋으로
        // 묶는다), 실패 전용 시각 상태를 따로 두지 않는다.
        // 로그는 stage 와 error.message 만 남긴다 — 이 파일이 다루는 Error 들은
        // (loginWithPkce/requestMedusaAuthorizeUrl 이 던지는 것 포함) 토큰·code·
        // state·전체 콜백 URL 같은 자격증명은 담지 않는다 — 그런 값은 이 catch
        // 블록에도 절대 넘기지 않는다. 단, requestMedusaAuthorizeUrl 실패(HTTP
        // 비-2xx) 의 error.message 에는 authorize.ts 가 잘라 담은 업스트림 응답
        // 본문의 앞부분(최대 200자)이 섞여 있을 수 있다 — 그 자체가 항상 순수
        // 진단 문자열이라는 보장은 아니고, "무제한 길이의 임의 응답 본문 전체가
        // 그대로 새지는 않는다"는 보장만 있다.
        console.warn(
          `[SplashGate] 로그인 흐름 실패: stage=${stage} reason=${
            error instanceof Error ? error.message : String(error)
          }`,
        )
        if (!cancelled) onReady(HOME_URL)
      }
    }

    run()
    return () => { cancelled = true }
  }, [onReady])

  return (
    <View style={styles.root} accessibilityLabel="준비 중">
      <ActivityIndicator size="large" />
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: "center", justifyContent: "center" },
})
