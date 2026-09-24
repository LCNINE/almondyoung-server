import { ApiNetworkError, HttpApiError } from "../../lib/api/api-error"

export type ShopListingActionFailure = {
  ok: false
  status: number
  message: string
}

export type ShopListingActionResult<T> =
  | { ok: true; data: T }
  | ShopListingActionFailure

/**
 * 서버 액션이 throw 한 에러는 프로덕션에서 메시지가 지워져 화면이 한도 초과(409)와 숨김(409)을
 * 구별할 문구를 잃는다. 그래서 회원 서버 액션은 throw 하지 않고 이 모양으로 돌려준다.
 *
 * message 는 4xx 이고 네트워크 에러가 아닐 때만 싣는다 — 그 구간만 우리가 쓴 문구다(한도 초과·
 * 검증 실패 등). 5xx·타임아웃·연결 끊김은 서버/인프라가 생성한 문구("서버 오류가 발생했습니다",
 * "NETWORK_ERROR")라 화면 톤(DESIGN.md)에 안 맞고 그대로 노출하면 안 된다 — 화면이 자기 문구를 쓴다.
 */
export function toActionFailure(error: unknown): ShopListingActionFailure {
  if (error instanceof HttpApiError) {
    const isClientError = error.status >= 400 && error.status < 500
    const message = isClientError && !(error instanceof ApiNetworkError) ? error.message : ""
    return { ok: false, status: error.status, message }
  }
  return { ok: false, status: 500, message: "" }
}
