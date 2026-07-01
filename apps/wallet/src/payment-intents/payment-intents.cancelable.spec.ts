import { CANCELABLE_INTENT_STATUSES } from './payment-intents.service';

describe('CANCELABLE_INTENT_STATUSES', () => {
  it('includes AWAITING_DEPOSIT so a pending deposit can be explicitly canceled', () => {
    expect(CANCELABLE_INTENT_STATUSES).toContain('AWAITING_DEPOSIT');
  });

  it('includes PENDING_SETTLEMENT so a CMS charge can be canceled before settlement (효성 출금삭제)', () => {
    // CMS 배치는 PENDING 시점에 이미 효성 출금신청이 들어가 있어, 정산 전 취소가
    // ChargeReleaseService 의 CMS 출금삭제 분기까지 도달해야 실제 은행 출금이 막힌다.
    // 게이트에서 이 상태를 cancelable 로 인정하지 않으면 취소가 400 으로 막혀 돈만 빠져나간다.
    expect(CANCELABLE_INTENT_STATUSES).toContain('PENDING_SETTLEMENT');
  });
});
