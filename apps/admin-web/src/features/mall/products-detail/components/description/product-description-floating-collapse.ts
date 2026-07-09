export interface FloatingCollapseVisibilityInput {
  /** Collapsible 이 펼쳐진 상태인지 */
  open: boolean;
  /** 펼쳐진 상세설명 본문이 뷰포트에 일부라도 보이는지 */
  contentVisible: boolean;
  /** 하단의 실제 "상품설명 접기" 버튼이 뷰포트에 완전히 보이는지 */
  triggerFullyVisible: boolean;
}

/**
 * 상세설명이 펼쳐진 상태에서, 본문은 화면에 보이지만 하단의 실제 접기 버튼이
 * 화면에 다 들어오지 않았을 때에만 floating 접기 버튼을 띄운다.
 *
 * - 접힌 상태(open=false) 에서는 띄우지 않는다.
 * - 섹션을 완전히 지나쳐 본문이 화면 밖(contentVisible=false)이면 띄우지 않는다.
 * - 실제 접기 버튼이 이미 화면에 다 보이면(triggerFullyVisible=true) 중복이므로 띄우지 않는다.
 */
export function shouldShowFloatingCollapse({
  open,
  contentVisible,
  triggerFullyVisible,
}: FloatingCollapseVisibilityInput): boolean {
  return open && contentVisible && !triggerFullyVisible;
}
