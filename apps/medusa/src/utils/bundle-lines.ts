/**
 * 함께 구매 라인 배분 — 담기 라우트와 카트 재판정 훅이 같이 쓰는 순수 계산.
 *
 * 규칙:
 * - 할인은 위젯으로 담은 구성품(B) 라인에만. 표시는 라인 metadata 의 부모 상품(A)으로 한다.
 * - B 의 할인 수량 = A 상품 전체 수량(옵션 합)까지. 같은 A 아래 같은 B 상품은 담긴 순서대로 한도를 나눠 쓴다. A 마다 따로 센다.
 * - 단가 = min(10원 내림(기준가 × (1 − %)), 그 고객·수량의 계산가). 기준가는 비회원 정가, 회원 멤버십가.
 *   번들가가 싸지 않으면 번들이 아니다(할인 0 을 번들이라 부르지 않는다).
 * - 자격을 잃은 라인은 일반가로 돌아가고 이유를 남긴다. 초과분은 일반 라인으로 옮긴다.
 */

export type BundleCartLine = {
  id: string;
  product_id: string;
  variant_id: string;
  quantity: number;
  unit_price: number;
  compare_at_unit_price: number | null;
  is_custom_price: boolean;
  created_at: Date;
  /** 위젯으로 담은 번들 라인이면 부모 상품(A) id */
  bundle_parent_product_id: string | null;
  /** 이 라인 단가를 정한 할인율(라인 metadata). 주문 뒤 멤버십 혜택 계산이 쓴다 */
  bundle_rates: BundleRates | null;
  /** metadata 에 번들 표시가 있다(커스텀 단가가 아니면 고객이 쓴 것 — 주문 뒤 계산이 믿지 않게 지운다) */
  has_bundle_marker?: boolean;
};

export type BundleRates = { regular_rate_bp: number; membership_rate_bp: number };

export type BundleOfferView = {
  product_id: string;
  addon_product_id: string;
  allowed_variant_ids: string[] | null;
  regular_rate_bp: number;
  membership_rate_bp: number;
  enabled: boolean;
  starts_at: Date | null;
  ends_at: Date | null;
};

export type PriceBasis = { regular: number; membership: number | null };

export type BundlePlanContext = {
  offers: BundleOfferView[];
  /** 지금 판매 중(published)인 상품 */
  sellableProducts: Set<string>;
  isMember: boolean;
  now: Date;
  /** 옵션별 정가·멤버십가(수량 1) */
  basis: Map<string, PriceBasis>;
  /** 그 고객에게 그 수량에 붙는 단가. 키는 priceKey */
  priceAt: Map<string, number>;
  /** 할인 가격표가 붙은 단가의 원래 가격(일반 라인의 compare_at 과 같은 규칙). 없으면 null */
  compareAt?: Map<string, number>;
};

export type ReleaseReason =
  | 'parent_removed'
  | 'over_limit'
  | 'offer_removed'
  | 'disabled'
  | 'out_of_period'
  | 'not_cheaper'
  /** 커스텀 단가인데 번들 표시가 없거나 깨졌다 — 이 단가를 만든 근거를 알 수 없다 */
  | 'invalid';

export type BundleLineChange =
  | ({ type: 'set_bundle'; line_id: string; quantity: number; unit_price: number; compare_at_unit_price: number } & BundleRates)
  | { type: 'release'; line_id: string; unit_price: number; compare_at_unit_price: number | null; reason: ReleaseReason }
  | {
      type: 'move_overflow';
      from_line_id: string;
      variant_id: string;
      quantity: number;
      /** 같은 옵션의 일반 라인이 있으면 거기로 합친다 */
      into_line_id: string | null;
      into_quantity: number;
      unit_price: number;
      compare_at_unit_price: number | null;
    };

export type BundleLinePlan = {
  changes: BundleLineChange[];
  /** 계산에 필요한데 받지 못한 단가. 받아서 다시 부른다 */
  missingPrices: Array<{ variant_id: string; quantity: number }>;
};

export const priceKey = (variantId: string, quantity: number) => `${variantId}:${quantity}`;

const BP_WHOLE = 10000;
const floor10 = (n: number) => Math.floor(n / 10) * 10;
const bundlePrice = (base: number, rateBp: number) => floor10(Math.floor((base * (BP_WHOLE - rateBp)) / BP_WHOLE));

export function planBundleLines(lines: BundleCartLine[], ctx: BundlePlanContext): BundleLinePlan {
  const plan: BundleLinePlan = { changes: [], missingPrices: [] };
  const bundles = lines
    .filter((l) => l.bundle_parent_product_id)
    .sort((a, b) => a.created_at.getTime() - b.created_at.getTime() || a.id.localeCompare(b.id));
  // 커스텀 단가인데 표시가 없거나, 표시만 있고 커스텀 단가가 아닌 라인 — 둘 다 이 기능이 만든 상태가 아니다
  const unmarked = lines.filter((l) => !l.bundle_parent_product_id && (l.is_custom_price || l.has_bundle_marker));
  if (bundles.length === 0 && unmarked.length === 0) return plan;

  const missing = new Map<string, { variant_id: string; quantity: number }>();
  const priceOf = (variantId: string, quantity: number): number | undefined => {
    const price = ctx.priceAt.get(priceKey(variantId, quantity));
    if (price === undefined) missing.set(priceKey(variantId, quantity), { variant_id: variantId, quantity });
    return price;
  };

  const parentQuantity = new Map<string, number>();
  for (const l of lines) {
    if (l.bundle_parent_product_id) continue;
    parentQuantity.set(l.product_id, (parentQuantity.get(l.product_id) ?? 0) + l.quantity);
  }
  const used = new Map<string, number>(); // `${A}|${B}` → 이미 번들로 쓴 수량
  const normalLines = lines.filter((l) => !l.bundle_parent_product_id && !l.is_custom_price);
  const changes: BundleLineChange[] = [];
  const compareAtOf = (variantId: string, quantity: number) => ctx.compareAt?.get(priceKey(variantId, quantity)) ?? null;

  for (const l of unmarked) {
    const unit = priceOf(l.variant_id, l.quantity);
    if (unit !== undefined) {
      changes.push({ type: 'release', line_id: l.id, unit_price: unit, compare_at_unit_price: compareAtOf(l.variant_id, l.quantity), reason: 'invalid' });
    }
  }

  for (const l of bundles) {
    const parent = l.bundle_parent_product_id as string;
    const release = (reason: ReleaseReason) => {
      const unit = priceOf(l.variant_id, l.quantity);
      if (unit !== undefined) {
        changes.push({ type: 'release', line_id: l.id, unit_price: unit, compare_at_unit_price: compareAtOf(l.variant_id, l.quantity), reason });
      }
    };

    const capacity = ctx.sellableProducts.has(parent) ? (parentQuantity.get(parent) ?? 0) : 0;
    if (capacity === 0) {
      release('parent_removed');
      continue;
    }
    const offer = ctx.offers.find((o) => o.product_id === parent && o.addon_product_id === l.product_id);
    if (!offer || !ctx.sellableProducts.has(l.product_id) || (offer.allowed_variant_ids && !offer.allowed_variant_ids.includes(l.variant_id))) {
      release('offer_removed');
      continue;
    }
    if (!offer.enabled) {
      release('disabled');
      continue;
    }
    if ((offer.starts_at && ctx.now < offer.starts_at) || (offer.ends_at && ctx.now > offer.ends_at)) {
      release('out_of_period');
      continue;
    }

    const usedKey = `${parent}|${l.product_id}`;
    const allowed = Math.min(l.quantity, capacity - (used.get(usedKey) ?? 0));
    if (allowed <= 0) {
      release('over_limit');
      continue;
    }

    const basis = ctx.basis.get(l.variant_id);
    const listed = priceOf(l.variant_id, allowed);
    if (!basis || listed === undefined) continue;
    const base = ctx.isMember ? (basis.membership ?? basis.regular) : basis.regular;
    const unit = bundlePrice(base, ctx.isMember ? offer.membership_rate_bp : offer.regular_rate_bp);
    if (unit >= listed) {
      release('not_cheaper');
      continue;
    }
    used.set(usedKey, (used.get(usedKey) ?? 0) + allowed);

    const ratesChanged =
      l.bundle_rates?.regular_rate_bp !== offer.regular_rate_bp || l.bundle_rates?.membership_rate_bp !== offer.membership_rate_bp;
    if (allowed !== l.quantity || l.unit_price !== unit || l.compare_at_unit_price !== listed || !l.is_custom_price || ratesChanged) {
      changes.push({
        type: 'set_bundle',
        line_id: l.id,
        quantity: allowed,
        unit_price: unit,
        compare_at_unit_price: listed,
        regular_rate_bp: offer.regular_rate_bp,
        membership_rate_bp: offer.membership_rate_bp,
      });
    }
    const overflow = l.quantity - allowed;
    if (overflow > 0) {
      const into = normalLines.find((n) => n.variant_id === l.variant_id);
      const intoQuantity = (into?.quantity ?? 0) + overflow;
      const intoPrice = priceOf(l.variant_id, intoQuantity);
      if (intoPrice !== undefined) {
        changes.push({
          type: 'move_overflow',
          from_line_id: l.id,
          variant_id: l.variant_id,
          quantity: overflow,
          into_line_id: into?.id ?? null,
          into_quantity: intoQuantity,
          unit_price: intoPrice,
          compare_at_unit_price: compareAtOf(l.variant_id, intoQuantity),
        });
      }
    }
  }

  plan.missingPrices = [...missing.values()];
  // 가격이 모자라면 반쯤 맞춘 결과를 쓰지 않는다 — 받아서 다시 부른다.
  plan.changes = plan.missingPrices.length > 0 ? [] : changes;
  return plan;
}

/**
 * 해제한 라인의 갱신값. 카트 모듈은 metadata 를 합치므로 키를 지우려면 빈 문자열을 넣어야 한다 —
 * 표시가 남으면 주문 뒤 멤버십 혜택 계산이 일반가로 산 라인을 함께 구매 라인으로 읽는다.
 */
export function releasedLineUpdate(change: Extract<BundleLineChange, { type: 'release' }>, now: Date) {
  return {
    is_custom_price: false,
    unit_price: change.unit_price,
    compare_at_unit_price: change.compare_at_unit_price,
    metadata: { bundle: '', bundle_released: { reason: change.reason, at: now.toISOString() } },
  };
}
