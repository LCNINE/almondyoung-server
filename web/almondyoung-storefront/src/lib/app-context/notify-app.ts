"use client"

/** 앱 웹뷰일 때만 앱에 상태를 통지한다. 웹 브라우저에서는 아무 일도 없다. */
export function notifyAppLogout(): void {
  // react-native-webview 가 주입하는 window.ReactNativeWebView 는 storefront(웹)
  // 쪽에 별도 ambient 타입 선언이 없는 런타임 전역이다 — lib.dom.d.ts 의 Window
  // 타입에 없는 속성이라 `as unknown as {...}` 로 한 번 넓혔다가 원하는 모양으로
  // 좁혀야 접근할 수 있다.
  const bridge = (window as unknown as {
    ReactNativeWebView?: { postMessage: (m: string) => void }
  }).ReactNativeWebView
  bridge?.postMessage(JSON.stringify({ type: "auth/logout" }))
}
