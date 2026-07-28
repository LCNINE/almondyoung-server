export type BackDecision = "go-back" | "warn" | "exit"

const DEFAULT_EXIT_WINDOW_MS = 2000

/**
 * 시스템 백 제스처 한 번을 어떻게 처리할지 판정한다. 순수 함수 — 상태는
 * 호출자(MainWebView)가 ref 로 들고 있다가 매 호출마다 넘겨준다.
 *
 * - 웹뷰 히스토리가 있으면 무조건 go-back.
 * - 루트(히스토리 없음)에서 첫 back 은 warn(토스트).
 * - 루트에서 두 번째 back 이 exitWindowMs 안에 들어오면 exit(기본 동작에 위임).
 * - exit 판정은 `now - lastBackPress < exitWindowMs` 로 배타적이다 — 경계값
 *   (diff === exitWindowMs) 은 exit 이 아니라 warn 이다.
 *
 * go-back 을 반환했을 때 lastBackPress 를 리셋하는 것은 호출자의 책임이다:
 * 리셋하지 않으면 "경고 → 상세 페이지 이동 → 윈도우 안에 루트로 복귀 후 back"
 * 시나리오에서 새 경고 없이 곧바로 종료돼 버린다.
 */
export function decideBack(input: {
  canGoBack: boolean
  now: number
  lastBackPress: number
  exitWindowMs?: number
}): BackDecision {
  if (input.canGoBack) return "go-back"
  const windowMs = input.exitWindowMs ?? DEFAULT_EXIT_WINDOW_MS
  return input.now - input.lastBackPress < windowMs ? "exit" : "warn"
}
