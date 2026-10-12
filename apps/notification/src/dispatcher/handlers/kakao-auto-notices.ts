/**
 * 알림톡으로 나가는 자동 알림 — 코드가 실제로 이 이벤트 키로 보내고, 이 변수들을 채운다.
 *
 * 관리자가 승인된 템플릿을 자동 알림에 이을 때 이 목록이 기준이다: 목록에 없는 알림에는 잇지 않고,
 * 템플릿이 여기 없는 변수(#{…})를 쓰면 막는다 — 채워지지 않은 변수가 있으면 카카오가 발송을 거절한다.
 * 시드(`BILLING_NOTICE_TEMPLATES`)와 같은지는 스펙이 지킨다.
 */
export interface KakaoAutoNotice {
  eventKey: string;
  name: string;
  condition: string;
  /** 코드가 채우는 변수 */
  variables: string[];
}

export const KAKAO_AUTO_NOTICES: readonly KakaoAutoNotice[] = [
  {
    eventKey: 'MEMBERSHIP_BILLING_ATTEMPT_FAILED',
    name: '멤버십 요금 출금 실패',
    condition: '정기결제 출금이 실패하고 재시도가 남았을 때',
    variables: ['name', 'period', 'amount', 'attempt', 'reason', 'nextDate', 'remaining'],
  },
  {
    eventKey: 'MEMBERSHIP_TERMINATED_WITH_ARREARS',
    name: '멤버십 해지 (미납 있음)',
    condition: '출금 재시도가 모두 실패해 해지되고 미납 요금이 남았을 때',
    variables: ['name', 'period', 'arrearsAmount'],
  },
  {
    eventKey: 'MEMBERSHIP_TERMINATED_NO_ARREARS',
    name: '멤버십 해지 (미납 없음)',
    condition: '출금 재시도가 모두 실패해 해지됐지만 남은 요금이 없을 때',
    variables: ['name', 'period'],
  },
  {
    eventKey: 'MEMBERSHIP_MANDATE_REJECTED_WITH_ARREARS',
    name: '멤버십 해지 (계좌 심사 거절, 미납 있음)',
    condition: '자동이체 계좌 심사가 거절되어 해지되고 미납 요금이 남았을 때',
    variables: ['name', 'period', 'arrearsAmount'],
  },
  {
    eventKey: 'MEMBERSHIP_MANDATE_REJECTED_NO_ARREARS',
    name: '멤버십 해지 (계좌 심사 거절, 미납 없음)',
    condition: '자동이체 계좌 심사가 거절되어 해지됐지만 남은 요금이 없을 때',
    variables: ['name'],
  },
];

export const findKakaoAutoNotice = (eventKey: string): KakaoAutoNotice | undefined =>
  KAKAO_AUTO_NOTICES.find((n) => n.eventKey === eventKey);
