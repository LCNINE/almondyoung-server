import { useCallback, useEffect, useRef, useState } from "react"
import { StatusBar, StyleSheet } from "react-native"
// `react-native` 내장 SafeAreaView 를 쓰면 안 된다 — 그건 iOS 전용 구현이고 Android 에서는
// 사실상 no-op 이다. Android 15 부터는 edge-to-edge 가 강제되어 앱이 상태바/내비게이션 바
// **뒤까지** 그리는 것이 기본이므로, 인셋을 실제로 적용하지 않으면 웹 콘텐츠가 시스템 바에
// 깔린다. 실제로 Galaxy S25(Android 16)에서 상단 헤더의 뒤로가기 버튼이 상태바 시계에,
// 장바구니의 구매 버튼이 내비게이션 바에 가려 둘 다 누를 수 없었다.
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context"
import * as Notifications from "expo-notifications"
import * as SecureStore from "expo-secure-store"
import { MainWebView } from "./src/webview/MainWebView"
import { ModalWebView } from "./src/webview/ModalWebView"
import { SplashGate } from "./src/session/SplashGate"
import { appEnv } from "./src/config/env"
import { usePushRegistration } from "./src/push/use-push"
import { createTokenStore } from "./src/auth/token-store"
import { ensureFreshAccessToken } from "./src/auth/pkce-login"
import { deactivateFcmToken } from "./src/push/registration"
import type { BridgeMessage } from "./src/bridge/messages"

const store = createTokenStore(SecureStore)

// 모듈 스코프에서 한 번만 등록한다 — expo-notifications 문서 권장 위치. 이게
// 없으면 앱이 포그라운드일 때 도착한 푸시가 화면에 전혀 표시되지 않는다(기본
// 동작은 "표시 안 함"). shouldShowBanner/shouldShowList 는 설치된
// expo-notifications(~57) 의 NotificationBehavior 가 요구하는 필수 필드다 —
// deprecated 된 shouldShowAlert 대신 이 둘을 채운다.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
})

export default function App() {
  const [initialUrl, setInitialUrl] = useState<string | null>(null)
  const [externalUrl, setExternalUrl] = useState<string | null>(null)
  const onReady = useCallback((url: string) => setInitialUrl(url), [])

  // initialUrl 은 'SplashGate 언마운트 스위치' 와 '웹뷰 주소' 두 역할을 겸한다.
  // 탭 리스너가 initialUrl 을 직접 읽으면(state 캡처) 등록 시점의 stale 값에
  // 갇히므로, 매 렌더마다 최신값을 미러링하는 ref 로 우회한다.
  const initialUrlRef = useRef(initialUrl)
  initialUrlRef.current = initialUrl

  // 로그인 완료 전에 도착한 탭 경로를 담아둔다. initialUrl 을 바로 세우면
  // SplashGate 가 언마운트되어 진행 중인 PKCE/웹뷰 로그인 흐름이 중단된다.
  // SplashGate 가 이 ref 를 직접 읽어 소비한다(스냅샷 prop 이 아니라 ref 를
  // 넘기는 이유: 로그인 흐름이 진행되는 동안 언제든 값이 채워질 수 있어서다).
  const pendingPath = useRef<string | null>(null)

  usePushRegistration(initialUrl !== null)

  const onBridgeMessage = useCallback(async (msg: BridgeMessage) => {
    if (msg.type !== "auth/logout") return
    // 여기서는 앱 자신의 PKCE 토큰(SecureStore)과 FCM 등록만 정리하고, 웹뷰는
    // 절대 건드리지 않는다 — initialUrl 을 null 로 되돌려 SplashGate 로 복귀시키지
    // 않는다(예전엔 그랬다). 이 브릿지 메시지는 웹의 signout() 서버 액션이 끝나기
    // *전에* 도착한다(signout 이 redirect() 로 끝나므로 호출부가 반드시 먼저 쏴야
    // 한다) — 완전한 웹 로그아웃은 이 메시지 이후로도 서버 액션
    // removeAllAuthTokens → auth-web /oauth/end_session 리다이렉트 → user-service
    // endSession(실제로 revokeAllUserTokens/deleteAllTokens 를 부르는 유일한 지점)
    // 까지 이어지는 순차적인 리다이렉트 체인을 웹뷰 안에서 몇 홉 더 거쳐야 끝난다.
    // 예전에는 이 메시지를 받자마자 웹뷰를 언마운트했는데, 그러면 그 체인이 중간에
    // 끊겨 서버 refresh 토큰이 revoke 되지 않고 auth-web 브라우저 세션(Custom
    // Tabs)도 살아있는 채로 남았다 — 공유 기기에서 다음 사용자가 SplashGate 의
    // 무음 재로그인으로 그 살아있는 IdP 세션을 그대로 이어받아 이전 계정에 들어가
    // 버리는 사고였다. 그래서 웹뷰는 살려두고 그 리다이렉트 체인이 스스로 끝까지
    // 진행되어 로그아웃된 storefront 홈에 도달하게 둔다 — '앱 토큰 없음 + 로그아웃된
    // 웹' 이 이 시점의 올바른 최종 상태다. 다음 콜드 스타트에서 App 이 다시
    // 마운트되고 SplashGate 가 토큰 없음을 보고 정상적으로 로그인을 새로 진행한다.
    try {
      const accessToken = await ensureFreshAccessToken(store)
      if (accessToken) {
        const devicePushToken = await Notifications.getDevicePushTokenAsync()
        await deactivateFcmToken(
          { fetch, baseUrl: appEnv.notificationUrl },
          { accessToken, token: String(devicePushToken.data) },
        )
      }
    } catch {
      // 비활성화 실패는 무시한다 — 네트워크가 죽어도 로컬 토큰 정리는 계속 진행해야
      // 방금 로그아웃한 계정의 유효한 토큰을 앱이 계속 들고 있는 사고를 막는다.
    }
    await store.clear()
    // 대기 중이던 탭 경로(로그인 흐름 도중 도착한 푸시)는 이 시점에 더 쓰일 곳이
    // 없다 — 웹뷰가 죽지 않으므로 SplashGate 가 다시 소비할 일도 없지만, 다음
    // 로그인 때 이전 세션의 값이 새어 들어가는 경로를 원천 차단하기 위해 비운다.
    pendingPath.current = null
  }, [])

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      // 앱-서버 계약: FCM data payload 의 `path` 키에 국가 프리픽스를 포함한
      // 절대 경로("/kr/products/123", "/products/123" 아님)를 담아 보내야 한다.
      // 서버의 fcm.provider.ts 는 이 키를 만들지 않는다 — 캠페인 발송 쪽에서
      // 이 계약을 지켜 채워 넣어야 한다. 자세한 내용/예시는 SMOKE.md 와
      // 설계 문서 §9.1 참고.
      const path = response.notification.request.content.data?.path
      if (typeof path !== "string" || !path.startsWith("/")) return
      if (initialUrlRef.current === null) {
        pendingPath.current = path // 아직 로그인 중 — SplashGate 가 소비한다
        return
      }
      setInitialUrl(`${appEnv.storefrontOrigin}${path}`)
    })
    return () => sub.remove()
  }, [])

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.root}>
        <StatusBar barStyle="dark-content" />
        {initialUrl === null ? (
          <SplashGate onReady={onReady} pendingPath={pendingPath} />
        ) : (
          <>
            <MainWebView
              initialUrl={initialUrl}
              onExternalUrl={setExternalUrl}
              onBridgeMessage={onBridgeMessage}
            />
            <ModalWebView url={externalUrl} onClose={() => setExternalUrl(null)} />
          </>
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  )
}

// 인셋 영역에는 이 배경색이 보인다. storefront 의 헤더/하단바가 흰색이라 흰색으로 맞춰야
// 시스템 바 옆에 이질적인 띠가 생기지 않는다. 투명하게 두면 검은 띠가 된다.
const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: "#fff" } })
