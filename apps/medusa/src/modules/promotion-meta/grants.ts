import type { CouponGrantRow } from './service';

/**
 * 발급된 «장» 들에 대한 판정 — 컨테이너도 워크플로도 모르는 순수 함수다.
 *
 * `validity.ts` 와 같은 자리에 두는 이유(P1 교훈): 라우트 안 클로저로 두면 검증 대상 밖이다.
 * 카트 미들웨어·체크아웃 백스톱·주문 생성 훅·표시 라우트 5곳이 전부 여기에 의존한다.
 *
 * ⚠️ 「사용 가능」의 정의는 `validity.ts` 의 `isUsable` 과 **경계가 같아야 한다** — 만료
 * 시각은 양쪽 다 포함이다. 두 곳이 어긋나면 카트에는 붙는데 주문에서 거절되는 창이 생긴다.
 */

function toDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 이 프로모션의 장만 추린다. */
export function grantsFor(grants: CouponGrantRow[], promotionId: string): CouponGrantRow[] {
  return grants.filter((g) => g.promotion_id === promotionId);
}

/** 지금 쓸 수 있는 장 — 미사용이고 만료 전(경계 포함). */
export function usableGrants(grants: CouponGrantRow[], now: Date): CouponGrantRow[] {
  return grants.filter((g) => {
    if (g.used_at != null) return false;
    const expiresAt = toDate(g.expires_at);
    if (expiresAt && now > expiresAt) return false;
    return true;
  });
}

export function hasUsableGrant(grants: CouponGrantRow[], now: Date): boolean {
  return usableGrants(grants, now).length > 0;
}

/**
 * 소모할 장 하나를 고른다 — **만료 임박순(FEFO)**.
 *
 * 무기한(`expires_at == null`) 장은 맨 뒤다. 그러지 않으면 기한 있는 장이 놀다가 죽는다.
 * 동률은 `issued_at` → `id` 로 깬다. **결정적이어야 테스트가 선다.**
 */
export function selectGrantToConsume(grants: CouponGrantRow[], now: Date): CouponGrantRow | null {
  const candidates = usableGrants(grants, now);
  if (candidates.length === 0) return null;

  const sorted = [...candidates].sort((a, b) => {
    const ax = toDate(a.expires_at);
    const bx = toDate(b.expires_at);
    if (ax && bx) {
      if (ax.getTime() !== bx.getTime()) return ax.getTime() - bx.getTime();
    } else if (ax) {
      return -1; // 기한 있는 쪽이 먼저
    } else if (bx) {
      return 1;
    }
    const ai = toDate(a.issued_at)?.getTime() ?? 0;
    const bi = toDate(b.issued_at)?.getTime() ?? 0;
    if (ai !== bi) return ai - bi;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return sorted[0];
}

/** 표시용 — 사용 가능한 장 중 가장 이른 만료. 무기한만 남았으면 null. */
export function nextExpiryAt(grants: CouponGrantRow[], now: Date): Date | null {
  const dated = usableGrants(grants, now)
    .map((g) => toDate(g.expires_at))
    .filter((d): d is Date => d !== null);
  if (dated.length === 0) return null;
  return dated.reduce((min, d) => (d < min ? d : min));
}
