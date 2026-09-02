/**
 * 발급 스킵 사유 → 안내 문구.
 *
 * `.tsx` 안에 있던 것을 `.ts` 로 뺐다 — admin-web 의 jest transform 이 `^.+\.(t|j)s$` 라
 * `.tsx` 안의 로직은 **테스트가 실행조차 되지 않는다**. 라벨 누락은 조용한 종류의 결함이라
 * (없는 값은 «발급할 수 없습니다» 로 뭉개진다) 검증 가능한 자리에 있어야 한다.
 */

/**
 * Medusa 발급 라우트가 낼 수 있는 사유의 **손으로 유지하는 사본**이다.
 * 정본은 `apps/medusa/src/api/admin/customers/[id]/promotions/route.ts` ·
 * `.../issue-coupons/route.ts` · `.../promotions/[id]/customers/route.ts`(대량발급, #488
 * Task 9)의 `skipped.push({ reason })` 자리들.
 * admin-web 이 medusa 를 import 할 수 없어(별도 트리·번들러 없음) 사본이 유일한 방법이다.
 */
export const BACKEND_SKIP_REASONS = [
  'inactive',
  'automatic',
  'not_started',
  'expired',
  'group_mismatch',
  'unsupported_rule',
  'max_claims_exceeded',
  'link_error',
  'already_issued',
  'customer_not_found',
  'grant_error',
  'public_promotion',
] as const;

const LABELS: Record<string, string> = {
  inactive: '비활성 쿠폰입니다.',
  automatic: '자동 적용 쿠폰은 수동 발급할 수 없습니다.',
  not_started: '아직 발급 기간이 아닙니다.',
  expired: '기간이 만료된 쿠폰입니다.',
  group_mismatch: '대상 고객 그룹이 아닙니다.',
  // 「고객을 그룹에 넣으면 된다」로 오해하지 않도록 그룹 불일치와 확실히 다른 문구를 쓴다.
  // 실제로 필요한 것은 발급 시점 평가 로직(issuance-rules.ts)에 그 조건을 구현하는 것이다.
  unsupported_rule:
    '이 쿠폰의 발급 조건은 아직 발급 시점에 판정할 수 없습니다. 개발팀 확인이 필요합니다(강제 발급은 가능).',
  max_claims_exceeded: '발급 수량이 소진되었습니다.',
  // 🔴 `link_error` 는 **쿠폰이 발급된 뒤** 표시용 링크 생성만 실패한 경우다 — 두 발생
  // 지점(발급 직후 / 전량 duplicate 후 `ensureLink`) 모두 그 시점엔 grant 가 이미 있다.
  // 옛 문구(「발급 처리 중 오류」)는 관리자에게 «발급 실패» 로 읽혀 실제 상태와 반대였다.
  // 같은 조건으로 다시 발급하면 전량 duplicate 로 떨어지면서 링크만 다시 만든다.
  link_error: '쿠폰은 발급됐지만 목록 표시가 지연될 수 있습니다. 같은 조건으로 다시 발급하면 복구됩니다.',
  already_issued: '이미 발급된 고객입니다.',
  // 대량발급(`/admin/promotions/:id/customers`) 전용 사유 — 고객id 가 존재하지 않음.
  customer_not_found: '존재하지 않는 고객입니다.',
  // 같은 라우트에서 grant 생성 자체가 실패한 경우(DB 오류 등) — 재시도 안내.
  grant_error: '발급 처리 중 오류가 발생했습니다. 다시 시도해주세요.',
  // 공개 쿠폰은 발급 대상이 아니다 (#488 A2). 발급하면 그 고객«만» 1회 제한에 걸리고
  // 나머지 고객은 계속 자유롭게 쓴다 — 선의가 정확히 반대로 작동하므로 발급 자체를 막는다.
  public_promotion: '공개 쿠폰은 발급할 수 없습니다. 이미 모든 고객이 사용할 수 있고, 발급하면 그 고객만 사용 횟수가 제한됩니다.',
  unknown: '발급할 수 없습니다.',
};

export function skipReasonLabel(reason: string | null | undefined): string {
  return (reason && LABELS[reason]) || LABELS.unknown;
}
