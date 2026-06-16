/**
 * 임시 기능 플래그.
 *
 * qna: 상품 상세의 Q&A 탭과 CS 1:1 문의(inquiry) 탭을 한꺼번에 닫는다.
 *      QnA 기능을 다시 열 때 `true` 로 바꾸면 모든 진입점(탭/버튼)이 복구된다.
 *      백엔드(ugc-service)와 DB 는 그대로 두고 프론트 UI 노출만 차단한다.
 */
export const FEATURES = {
  qna: false,
} as const
