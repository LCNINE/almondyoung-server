import type { MedusaPromotion } from '@/lib/api/domains/medusa/promotions';

/**
 * 쿠폰 목록의 "사용 조건" 칸을 조립한다.
 *
 * 전역 사용 한도의 저장 위치가 둘로 갈린다 — 옛 쿠폰은 campaign.budget{type:'usage'},
 * 신규 쿠폰(2026-08 이후)은 promotion.limit. 둘 다 표시해야 하위 호환이 깨지지 않는다.
 * 자세한 배경은 docs/adr/0033-coupons-are-owned-by-the-sales-channel.md 참조.
 *
 * .tsx 는 jest transform 밖(admin-web jest 설정 `^.+\.(t|j)s$`)이라 이 로직을 순수 .ts 로
 * 뽑아야 테스트가 실제로 돌아간다 — 이 파일 자체가 그 교훈의 산물이다.
 */
export function formatCouponConditions(coupon: MedusaPromotion): string {
  const parts: string[] = [];

  const minOrder = coupon.rules?.find((r) => r.attribute === 'subtotal' && r.operator === 'gte');
  if (minOrder) {
    const rawVal = minOrder.values[0];
    const minOrderNum = Number((rawVal as { value?: unknown })?.value ?? rawVal);
    parts.push(`${minOrderNum.toLocaleString('ko-KR')}원 이상`);
  }

  // 신규 쿠폰: promotion.limit 이 전역 사용 한도.
  if (coupon.limit != null) {
    parts.push(`전체 ${coupon.limit.toLocaleString('ko-KR')}회`);
  }

  // 옛 쿠폰(하위 호환) + 1인당 한도 + 총 할인금액 — 전부 campaign budget 에서 나온다.
  const budget = coupon.campaign?.budget;
  if (budget?.limit) {
    if (budget.type === 'spend') {
      parts.push(`총 ${budget.limit.toLocaleString('ko-KR')}원 한도`);
    } else if (budget.type === 'use_by_attribute') {
      parts.push(`1인당 ${budget.limit.toLocaleString('ko-KR')}회`);
    } else if (budget.type === 'usage') {
      // promotion.limit 이 있는 신규 쿠폰이면 이미 위에서 표시했으므로 중복 방지.
      if (coupon.limit == null) {
        parts.push(`전체 ${budget.limit.toLocaleString('ko-KR')}회`);
      }
    } else {
      parts.push(`예산 ${budget.limit.toLocaleString('ko-KR')}`);
    }
  }

  return parts.length > 0 ? parts.join(' · ') : '-';
}
