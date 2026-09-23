import { HttpApiError } from "../../lib/api/api-error"

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
 */
export function toActionFailure(error: unknown): ShopListingActionFailure {
  if (error instanceof HttpApiError) {
    return { ok: false, status: error.status, message: error.message }
  }
  return { ok: false, status: 500, message: "" }
}
