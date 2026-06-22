/**
 * 카트에 담긴 variant 가 draft/미게시/삭제 상태라 Medusa 가 카트 작업
 * (배송수단 추가, 라인아이템 생성 등)을 거부할 때 나오는 에러를 다루는 유틸.
 */
const UNAVAILABLE_VARIANT_MESSAGE_REGEX =
  /do not exist or belong to a product that is not published/i

export function isUnavailableVariantError(error: unknown): boolean {
  const message = (error as { message?: string })?.message ?? ""
  return UNAVAILABLE_VARIANT_MESSAGE_REGEX.test(message)
}

/** 에러 메시지에서 문제된 variant id 목록을 중복 제거해 추출한다. */
export function extractUnavailableVariantIds(error: unknown): string[] {
  const message = (error as { message?: string })?.message ?? ""
  const ids = message.match(/variant_[A-Za-z0-9]+/g) ?? []
  return Array.from(new Set(ids))
}
