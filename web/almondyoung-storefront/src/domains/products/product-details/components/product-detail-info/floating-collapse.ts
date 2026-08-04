export interface FloatingCollapseVisibilityInput {
  /** 상세설명이 펼쳐진 상태인지 */
  isExpanded: boolean
  /** 펼쳐진 본문이 뷰포트에 일부라도 보이는지 */
  contentVisible: boolean
  /** 하단의 실제 "접기" 버튼이 뷰포트에 완전히 보이는지 */
  triggerFullyVisible: boolean
}

/**
 * 펼쳐진 상태에서 본문은 보이지만 하단의 실제 접기 버튼이 아직 화면 밖일 때만 true.
 * 접힘 / 본문을 지나침 / 실제 버튼이 이미 보임 — 세 경우는 모두 false.
 */
export function shouldShowFloatingCollapse({
  isExpanded,
  contentVisible,
  triggerFullyVisible,
}: FloatingCollapseVisibilityInput): boolean {
  return isExpanded && contentVisible && !triggerFullyVisible
}
