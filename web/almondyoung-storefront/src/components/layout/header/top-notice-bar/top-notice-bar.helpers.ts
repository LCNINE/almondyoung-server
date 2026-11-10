export const TOP_NOTICE_INTERVAL_MS = 4500
export const TOP_NOTICE_TRANSITION_MS = 1200

export type TopNoticeItemState = "current" | "leave" | "enter"

export function nextNoticeIndex(current: number, length: number): number {
  if (length <= 0) {
    return 0
  }

  return (current + 1) % length
}

/**
 * 지금 공지는 제자리, 방금 넘어간 공지는 위로, 나머지는 아래에서 대기한다.
 * 공지가 둘뿐이면 같은 공지가 곧바로 다시 들어오므로, 떠난 공지가 전환을 마치면
 * leaving 을 비워 아래 대기 자리로 되돌린다.
 */
export function noticeItemState(
  index: number,
  current: number,
  leaving: number | null
): TopNoticeItemState {
  if (index === current) {
    return "current"
  }

  if (index === leaving) {
    return "leave"
  }

  return "enter"
}

export function isExternalNoticeLink(url: string): boolean {
  return /^https?:\/\//i.test(url.trim())
}
