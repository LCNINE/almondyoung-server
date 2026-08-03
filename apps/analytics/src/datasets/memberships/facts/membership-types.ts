export type MembershipFactResult = {
  claimed: boolean;
  userId: string;
  status: string;
  tierId: string;
  /**
   * 이벤트가 실어온 구독 계약 ID (`payload.contractId`, contract 상 optional 이라 null 가능).
   * fact 행에도 남지만 차원(`dim_customer_membership.contract_id`)에도 필요하다 —
   * 백필이 멤버십을 `contractId` 로 키잉하므로 이게 없으면 백필이 만든 구간과 실시간 구간을
   * 대조할 방법이 없다.
   */
  contractId: string | null;
  occurredAt: Date;
};

/** 새 등급 구간을 여는 상태. */
export const MEMBERSHIP_OPENING_STATUSES = ['ACTIVE', 'RESUMED'] as const;

/**
 * 구간을 **열지도 닫지도 않는** 상태 — 차원에 대해 no-op 이다.
 *
 * `RECURRING_CANCELLED` 는 "해지"가 아니라 "자동갱신 중단"이다. 회원 자격은 현재 결제주기가
 * 끝날 때까지 그대로 유지된다:
 *
 * - `subscription-cancellation.manager.ts:230-238` 이 `currentPeriodEndsAt` 과 함께
 *   "현재 구독은 ...까지 유효합니다" 를 돌려주고, 계약 status 는 건드리지 않은 채
 *   `recurringCancelledAt`/`autoRenewal=false` 만 세팅한다.
 * - `subscription.service.ts:65-67` 이 "정기해지는 잔여기간 동안 status=ACTIVE 를 유지해야
 *   회원 화면에 도달한다" 고 명시한다.
 * - `admin-members.reader.ts:255-261` 은 이 상태를 `status='ACTIVE' AND recurringCancelledAt
 *   IS NOT NULL` 로 조회한다 — 즉 여전히 ACTIVE 다.
 *
 * 실제 종료는 나중에 `EXPIRED` 로 온다 (`recurring-billing.service.ts` → `billing-outcome.handler.ts`).
 *
 * **이걸 닫기로 취급하면 자가해지한 회원이 최대 한 결제주기 동안 등급 귀속을 잃는다** —
 * 하필 "만료 전에 다 쓰자" 주문이 몰리는 구간이다. 게다가 뒤늦게 온 `EXPIRED` 는 닫을 열린
 * 구간을 못 찾아 debug 로그만 남기므로 손실이 눈에 띄지도 않는다.
 *
 * churn 분석에 필요한 정보는 `fact_membership_events` 행에 이미 남으므로 차원에서 no-op
 * 으로 두어도 잃는 것이 없다.
 */
export const MEMBERSHIP_NEUTRAL_STATUSES = ['RECURRING_CANCELLED'] as const;

export function opensInterval(status: string): boolean {
  return (MEMBERSHIP_OPENING_STATUSES as readonly string[]).includes(status);
}

/**
 * 열린 구간을 닫는 상태 — 여는 것도 중립도 아닌 나머지 전부 (`PAUSED`/`CANCELLED`/`EXPIRED`).
 *
 * `!opensInterval(status)` 을 그대로 닫기로 쓰면 안 된다. 중립 상태가 그 안에 섞여 들어간다.
 */
export function closesInterval(status: string): boolean {
  return !opensInterval(status) && !(MEMBERSHIP_NEUTRAL_STATUSES as readonly string[]).includes(status);
}
