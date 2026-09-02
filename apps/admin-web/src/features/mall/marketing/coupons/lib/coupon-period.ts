import type { MedusaPromotion } from '@/lib/api/domains/medusa/promotions';

/**
 * 쿠폰 기간 표시·판정 (#488 결정 1).
 *
 * 정본은 `promotion_meta` 의 `starts_at`/`ends_at`/`validity_days` 다 — 캠페인 날짜는 더 이상
 * 쓰지 않는다. `.tsx` 는 jest transform 밖이라 판정을 여기 `.ts` 에 둔다(#488 P1 교훈).
 */

function fmt(iso: unknown): string | null {
  if (typeof iso !== 'string' || !iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('ko-KR', { year: '2-digit', month: '2-digit', day: '2-digit' });
}

function meta(coupon: Pick<MedusaPromotion, 'metadata'>): Record<string, unknown> {
  return coupon.metadata ?? {};
}

/** 「25. 09. 01. ~ 25. 09. 30. · 발급 후 30일」 꼴. 아무것도 없으면 「무기한」. */
export function couponPeriodText(coupon: Pick<MedusaPromotion, 'metadata'>): string {
  const m = meta(coupon);
  const start = fmt(m.starts_at);
  const end = fmt(m.ends_at);
  const days = Number(m.validity_days);

  let range: string;
  if (start && end) range = `${start} ~ ${end}`;
  else if (end) range = `~ ${end}`;
  else if (start) range = `${start} ~`;
  else range = '무기한';

  return Number.isFinite(days) && days > 0 ? `${range} · 발급 후 ${days}일` : range;
}

/** 발급 창이 끝났는가. 목록의 「만료」 필터가 묻는 질문이다. */
export function isCouponExpired(coupon: Pick<MedusaPromotion, 'metadata'>, now: Date): boolean {
  const raw = meta(coupon).ends_at;
  if (typeof raw !== 'string' || !raw) return false;
  const d = new Date(raw);
  return !Number.isNaN(d.getTime()) && d < now;
}
