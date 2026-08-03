import { useCallback, useEffect, useRef, useState } from "react"
import { BackHandler, ToastAndroid } from "react-native"
import { WebView, type WebViewNavigation } from "react-native-webview"
import * as Application from "expo-application"
import { useFocusEffect } from "./use-focus-effect"
import { appEnv } from "../config/env"
import { buildUserAgentSuffix } from "../app-context/user-agent"
import { classifyUrl } from "./url-policy"
import { decideBack } from "./back-policy"
import { ErrorScreen } from "./ErrorScreen"
import { parseBridgeMessage, type BridgeMessage } from "../bridge/messages"

const INTERNAL_HOSTS = [
  new URL(appEnv.storefrontOrigin).hostname,
  new URL(appEnv.authWebOrigin).hostname,
]

type Props = {
  initialUrl: string
  onExternalUrl: (url: string) => void
  onBridgeMessage: (m: BridgeMessage) => void
}

/** initialUrl 이 바뀌면 react-native-webview 가 해당 URL 로 이동한다. */
export function MainWebView({ initialUrl, onExternalUrl, onBridgeMessage }: Props) {
    const webRef = useRef<WebView>(null)
    const canGoBack = useRef(false)
    const lastBackPress = useRef(0)
    const currentUrl = useRef(initialUrl)
    const [loadFailed, setLoadFailed] = useState(false)
    const [activeUrl, setActiveUrl] = useState(initialUrl)
    const [instanceKey, setInstanceKey] = useState(0)

    // 부모가 initialUrl 을 바꾸면(알림 탭, 로그아웃 복귀) 그대로 반영한다. retry 가
    // activeUrl 을 덮어써도 이 effect 는 initialUrl 자체가 실제로 바뀔 때만
    // 재실행되므로, retry 직후 activeUrl 을 initialUrl 로 되돌리지 않는다.
    useEffect(() => {
      setActiveUrl(initialUrl)
    }, [initialUrl])

    const failLoad = useCallback(() => {
      // 실패 화면으로 전환되면 WebView 가 언마운트되어 onNavigationStateChange 가
      // 더 이상 발생하지 않는다. canGoBack 을 리셋하지 않으면 실패 직전 값에 멈춰있어
      // decideBack 이 계속 "go-back" 을 반환하고, null 이 된 webRef 위에서 goBack() 이
      // no-op 되면서 하드웨어 뒤로가기가 (토스트도, 종료도 없이) 무한히 먹통이 된다.
      canGoBack.current = false
      setLoadFailed(true)
    }, [])

    const onBack = useCallback(() => {
      const now = Date.now()
      const decision = decideBack({
        canGoBack: canGoBack.current,
        now,
        lastBackPress: lastBackPress.current,
      })
      if (decision === "go-back") {
        webRef.current?.goBack()
        lastBackPress.current = 0 // 다음 루트 복귀 시 새로 경고하도록 리셋
        return true
      }
      if (decision === "warn") {
        lastBackPress.current = now
        ToastAndroid.show("한 번 더 누르면 종료됩니다", ToastAndroid.SHORT)
        return true
      }
      return false // exit — 두 번째 → 앱 종료
    }, [])

    useFocusEffect(() => {
      const sub = BackHandler.addEventListener("hardwareBackPress", onBack)
      return () => sub.remove()
    })

    if (loadFailed) {
      return (
        <ErrorScreen
          onRetry={() => {
            setLoadFailed(false)
            // 실패 직전까지 있던 페이지로 재시도한다 — initialUrl 로 되돌리면
            // 체크아웃 도중의 500 이후 "다시 시도"가 사용자를 조용히 홈으로 튕겨낸다.
            setActiveUrl(currentUrl.current)
            // onRenderProcessGone 이후에는 렌더러 프로세스 자체가 죽어있을 수 있어
            // 같은 인스턴스를 재사용하는 것만으로는 복구되지 않을 수 있다 — key 를
            // 바꿔 새 WebView 인스턴스를 강제한다.
            setInstanceKey((k) => k + 1)
          }}
        />
      )
    }

    return (
      <WebView
        key={instanceKey}
        ref={webRef}
        source={{ uri: activeUrl }}
        applicationNameForUserAgent={buildUserAgentSuffix({
          appVersion: Application.nativeApplicationVersion ?? "0.0.0",
          platform: "android",
        })}
        pullToRefreshEnabled
        allowsBackForwardNavigationGestures
        onNavigationStateChange={(nav: WebViewNavigation) => {
          canGoBack.current = nav.canGoBack
          currentUrl.current = nav.url
        }}
        onShouldStartLoadWithRequest={(req) => {
          if (classifyUrl(req.url, INTERNAL_HOSTS) === "external") {
            onExternalUrl(req.url)
            return false
          }
          return true
        }}
        onMessage={(e) => {
          const msg = parseBridgeMessage(e.nativeEvent.data)
          if (msg) onBridgeMessage(msg)
        }}
        onError={failLoad}
        onHttpError={(e) => {
          if (e.nativeEvent.statusCode >= 500) failLoad()
        }}
        onRenderProcessGone={() => {
          // Android WebView 프로세스가 죽으면 재생성하지 않는 한 앱이 통째로 멈춘다.
          // didCrash() 여부(실제 크래시 vs 시스템의 강제 회수)는 구분하지 않는다 —
          // 둘 다 렌더러 프로세스가 죽은 것이고 복구 방법(재마운트)도 동일하다.
          // 이 콜백의 반환값은 무시된다 — 설치된 react-native-webview(13.16.1)의
          // onRenderProcessGone prop 타입은 void 이고, 네이티브(RNCWebViewClient.java)가
          // 항상 true 를 Android 에 돌려주므로 크래시 방지는 라이브러리가 이미 보장한다.
          failLoad()
        }}
      />
    )
}
