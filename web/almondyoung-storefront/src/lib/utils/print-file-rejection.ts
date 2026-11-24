// 와우프레스 파일 에러 코드 중 고객에게 사유를 따로 알려 주는 것. 나머지는 "파일을 열 수 없어요"로 묶는다
const KNOWN_REASONS = new Set([121, 122, 123, 124, 125, 126, 127, 129, 130])

export const printFileReasonKey = (jobstat: number | null): string =>
  jobstat !== null && KNOWN_REASONS.has(jobstat) ? String(jobstat) : "other"

// 알림에서 주문 상세의 그 줄로 바로 내려가게 하는 쿼리. 주문 상세는 PC·모바일 화면을 함께 그려 id 앵커가 두 벌이 된다
export const PRINT_LINE_PARAM = "printLine"

export const printFileRejectionHref = (rejection: {
  channelOrderId: string
  channelOrderItemId: string | null
}) => {
  const params = new URLSearchParams({ orderId: rejection.channelOrderId })
  if (rejection.channelOrderItemId) {
    params.set(PRINT_LINE_PARAM, rejection.channelOrderItemId)
  }

  return `/mypage/order/details?${params.toString()}`
}
