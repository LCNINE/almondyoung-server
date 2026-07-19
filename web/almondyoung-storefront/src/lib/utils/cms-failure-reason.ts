// 효성 CMS 회원등록 실패 Q-코드 → 고객 표시용 사유 그룹. (ADR-0027 §5-3)
// Q-코드를 그대로 노출하지 않고 사용자 언어로 매핑한다. 실제 문구는 i18n
// (mypage.membershipPaymentMethod.cmsFailureReason.<key>)에서 locale별로 관리.
const CODE_TO_REASON_KEY: Record<string, string> = {
  Q201: "mismatch", // 생년월일/사업자번호 불일치 (실측 최대 실패군)
  Q202: "unverifiedAccount", // 실명미확인계좌
  Q101: "accountNumber", // 계좌번호 오류
  Q122: "accountNumber",
  Q102: "unusableAccount", // 해지·출금불가·유형오류
  Q108: "unusableAccount",
  Q114: "unusableAccount",
  Q121: "unusableAccount",
}

export function getCmsFailureReasonKey(code?: string | null): string {
  if (code && CODE_TO_REASON_KEY[code]) return CODE_TO_REASON_KEY[code]
  return "default"
}
