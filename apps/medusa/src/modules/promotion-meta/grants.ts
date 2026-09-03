import type { CouponGrantRow } from './service';

/**
 * 발급된 «장» 들에 대한 판정 — 컨테이너도 워크플로도 모르는 순수 함수다.
 *
 * `validity.ts` 와 같은 자리에 두는 이유(P1 교훈): 라우트 안 클로저로 두면 검증 대상 밖이다.
 * 소비자는 7곳이다(2026-09-03, Task 7 이 클레임을 더했다) — 카트 미들웨어
 * (`per-customer-limit.ts`) · 체크아웃 백스톱(`complete-cart.ts`) · 주문 생성 소모 훅
 * (`coupon-usage.ts`) · 마이페이지(`store/customers/me/promotions/route.ts`) · 이벤트 페이지
 * (`store/events/[slug]/route.ts`) · 코드 미리보기(`store/coupons/preview/route.ts`) ·
 * 쿠폰 클레임(`store/customers/me/promotions/[id]/claim/route.ts`).
 *
 * ⚠️ 「사용 가능」의 정의는 `validity.ts` 의 `isUsable` 과 **경계가 같아야 한다** — 만료
 * 시각은 양쪽 다 포함이다. 두 곳이 어긋나면 카트에는 붙는데 주문에서 거절되는 창이 생긴다.
 *
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
 * 이 쿠폰의 「1장 = 1회」를 **장이** 정하는가, 아니면 정책이 정하는가 (#488 A2).
 *
 * 게이트들은 원래 `mine.length > 0` 하나로 갈랐다. 그런데 `public` 쿠폰은 «발급» 개념이
 * 없는데도 장이 생길 수 있다 — 관리자가 선의로 직권 발급하거나, `assigned_only` 로 발급한
 * 뒤 visibility 를 `public` 으로 바꾸는 경우다. 그러면 **장을 받은 그 고객만** 장 수만큼
 * 제한되고 나머지 전원은 계속 자유롭게 쓴다. 선의가 정확히 반대로 작동한다.
 *
 * 발급 3경로(고객축·쿠폰축·트리거)는 이제 `public` 을 `public_promotion` 으로 거절하므로
 * 이 상태는 보통 생기지 않는다. 이 함수는 **그 검사가 못 잡는 경로**를 위한 것이다 —
 * 발급이 끝난 뒤에 visibility 를 바꾸는 것은 발급 시점에 알 수 없다.
 *
 * ⚠️ **일곱 소비자 중 다섯 곳에서 쓴다**(2026-09-03 기준, ADR-0034 가 둘을 더 옮겼다) —
 * 거절이 일어나는 둘(카트 미들웨어 `per-customer-limit:59`·체크아웃 백스톱
 * `complete-cart:63`), 그 판정을 그대로 비춰야 하는 마이페이지
 * (`store/customers/me/promotions:172`), 그리고 표시 두 곳(`store/coupons/preview:95` ·
 * `store/events/[slug]:97`)이다. 표시와 판정이 갈리면 「목록엔 없는데 코드를 넣으면 쓰이는」
 * — 또는 그 반대로 「패널은 못 쓴다는데 카트는 받아주는」 — 쿠폰이 생긴다. 표시 둘은 그
 * 반대 방향으로 실제로 갈려 있었고, 그래서 이 함수로 옮겼다.
 *
 * 남은 둘은 **소모 훅**(`workflows/hooks/cart/coupon-usage.ts`)과 **쿠폰 클레임**
 * (`store/customers/me/promotions/[id]/claim/route.ts`)이고, 쓰지 않는 이유가 서로 다르다.
 * 소모 훅은 일부러 장 유무로 갈린다 — 고를 장이 없으면 그냥 건너뛰므로 어긋나도 고객이
 * «못 쓰게» 되지 않는다. 클레임 라우트는 애초에 `visibility === 'claimable'` 인 쿠폰만
 * 처리한다(`claim/route.ts:37-39` — 아니면 그 앞에서 거절) — 이 함수가 푸는 문제(«공개»
 * 쿠폰에서 장 유무로 오판하는 것)가 그 라우트엔 아예 생기지 않는다. 대신 「이 고객이 이미
 * 발급받았는가」를 묻는 `grantsFor`/`hasUsableGrant` 를 직접 쓴다 — `grantsGovernUsage`
 * 와는 다른 질문이다.
 *
 * 🔴 **이 목록을 늘리거나 줄일 때 이 주석을 같이 고칠 것.** 낡은 목록은 다음 사람이
 * 「표시 vs 판정」 감사를 틀린 모델로 하게 만든다 — #488 이 반복해서 물린 자리다.
 *
 * `visibility` 는 호출부가 `resolveVisibility(meta)` 로 이미 접은 값을 넘긴다(메타가 없으면
 * `assigned_only`). 어휘 밖 값은 발급형으로 본다 — 닫힌 쪽이 기본값이다.
 */
export function grantsGovernUsage(grants: CouponGrantRow[], visibility: string): boolean {
  return grants.length > 0 && visibility !== 'public';
}

/**
 * 이 장들 중 **마지막으로 쓴 시각**. 쓴 장이 하나도 없으면 `null` (#488 A1).
 *
 * 마이페이지의 「사용완료」 바구니가 정렬·컷오프에 쓴다. `nextExpiryAt` 이 «사용 가능한 장
 * 중 가장 이른 만료»(앞으로 다가올 것)를 보는 것과 대칭으로, 이쪽은 «이미 지나간 것 중 가장
 * 최근»을 본다 — 그래서 `usableGrants` 로 좁히지 않고 전 장을 본다.
 */
export function latestUsedAt(grants: CouponGrantRow[]): Date | null {
  const dated = grants
    .map((g) => toDate(g.used_at))
    .filter((d): d is Date => d !== null);
  if (dated.length === 0) return null;
  return dated.reduce((max, d) => (d > max ? d : max));
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
