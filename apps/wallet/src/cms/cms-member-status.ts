// 효성 getMember 응답의 member.status(한글) → 내부 판정.
// 회원등록은 D+1 비동기라 '신청중' 같은 진행 상태를 거친 뒤 '신청완료'/'신청실패'로 확정된다.
export type LiveCmsMemberStatus = 'REGISTERED' | 'FAILED' | 'IN_FLIGHT';

export function interpretLiveCmsMemberStatus(apiStatus: string | undefined | null): LiveCmsMemberStatus {
  if (apiStatus === '신청완료') return 'REGISTERED';
  if (apiStatus === '신청실패') return 'FAILED';
  return 'IN_FLIGHT';
}
