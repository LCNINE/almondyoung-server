// 효성 CMS 회원등록 실패 Q-코드 → CS 안내용 사유. (ADR-0027 §5-3)
// 관리자가 raw 코드만 보고 헷갈리지 않도록, 고객에게 안내할 문구를 그대로 노출한다.
const CODE_TO_REASON: Record<string, string> = {
  Q201: '계좌주 정보(성함·생년월일/사업자번호)가 은행 등록정보와 불일치',
  Q202: '실명확인이 안 된 계좌',
  Q101: '계좌번호 오류',
  Q122: '계좌번호 오류',
  Q102: '자동이체로 사용할 수 없는 계좌(해지·출금불가·유형오류)',
  Q108: '자동이체로 사용할 수 없는 계좌(해지·출금불가·유형오류)',
  Q114: '자동이체로 사용할 수 없는 계좌(해지·출금불가·유형오류)',
  Q121: '자동이체로 사용할 수 없는 계좌(해지·출금불가·유형오류)',
};

/** resultCode 를 CS 안내 문구로. 매핑에 없으면 undefined(원문 메시지에 맡김). */
export function cmsFailureReason(code?: string | null): string | undefined {
  if (!code) return undefined;
  return CODE_TO_REASON[code];
}
