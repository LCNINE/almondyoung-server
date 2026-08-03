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

    // SplashGate 의 f866fb9a9 와 같은 이유로 각 await 직후 즉시 cancelled 를
    // 확인한다 — 포그라운드/백그라운드가 빠르게 반복되며 effect 가 재실행될 때
    // 낡은 sync() 가 언마운트 이후에도 requestPermissionsAsync/
    // getDevicePushTokenAsync/registerFcmToken 같은 부수효과를 실행하는 사고를
    // 막는다. 마지막 await(registerFcmToken) 뒤에는 이어지는 코드가 없으므로
    // 별도 가드가 필요 없다.
    async function sync() {
      let stage = "ensure-token"
      try {
        const accessToken = await ensureFreshAccessToken(store)
        if (!accessToken || cancelled) return
        stage = "request-permissions"
        const perm = await Notifications.requestPermissionsAsync()
        if (!perm.granted || cancelled) return
        stage = "get-device-token"
        const devicePushToken = await Notifications.getDevicePushTokenAsync()
        if (cancelled) return
        stage = "register-fcm-token"
        await registerFcmToken(deps, {
          accessToken,
          payload: buildRegistrationPayload({
            token: String(devicePushToken.data),
            deviceId: Application.getAndroidId() ?? undefined,
            deviceModel: Device.modelName ?? undefined,
            deviceName: Device.deviceName ?? undefined,
          }),
        })
      } catch (error) {
        // 푸시 등록 실패가 앱 사용을 막아서는 안 된다 — 그래도 신호는 남긴다.
        // accessToken/FCM 토큰 등 자격증명은 절대 로그하지 않는다 — stage 와
        // error.message 만 남긴다 (SplashGate 의 로깅 규칙과 동일).
        console.warn(
          `[usePushRegistration] 등록 실패: stage=${stage} reason=${
            error instanceof Error ? error.message : String(error)
          }`,
        )
      }
    }

    sync()
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") sync()
    })
    return () => {
      cancelled = true
      sub.remove()
    }
  }, [ready])
}
