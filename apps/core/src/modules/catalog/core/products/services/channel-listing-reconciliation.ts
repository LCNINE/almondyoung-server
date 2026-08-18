/**
 * publish 후 채널 리스팅 승계의 **판정** (#652).
 *
 * DB 를 모르는 순수 함수만 둔다 — 판정이 서비스 안에 있으면 스펙이 private 메서드를
 * 타입을 지운 채 부르게 되고, 그러면 인자 순서가 바뀌어도 type-check 가 못 잡는다.
 */

/** variant 한 벌과 그 옵션값 조합 — twin 짝 찾기의 입력. */
export interface VariantOptionCombo {
  variantId: string;
  optionValueIds: string[];
}

/** 승계 판정 대상 채널 리스팅 (#652). */
export interface ReconcilableListing {
  id: string;
  variantId: string;
  /** 네이버·쿠팡 등 외부 마켓플레이스인가 — 디지털 상품은 여기 실릴 수 없다. */
  isExternalMarketplace: boolean;
  isActive: boolean;
}

/**
 * 리스팅 승계 판정 결과 (#652).
 *
 * 재지정과 비활성은 **배타적이지 않다** — 디지털 전환으로 끄는 리스팅도 짝이 있으면 같이
 * 옮겨 둬야 나중에 되살릴 수 있다. 죽은 variant 를 가리킨 채 꺼진 행은 재활성도
 * 재등록도(`uq_channel_variant_listing`) 막혀 삭제 말고는 길이 없다.
 */
export interface ChannelListingReconciliationPlan {
  updates: Array<{ listingId: string; newVariantId: string | null; deactivate: boolean }>;
}

/** 스펙이 private 판정 함수를 타입을 지운 채 부르지 않도록 노출하는 표면. */

/** 옵션값 조합의 정규화 키. 순서가 달라도 같은 조합이면 같은 키다. */
export function comboKey(optionValueIds: string[]): string {
  return [...optionValueIds].sort().join('|');
}

/**
 * 리스팅 승계 판정 (#652) — 순수 함수.
 *
 * 리스팅 한 건에 대해 독립된 두 결정을 내린다.
 * - **어디를 가리켜야 하나**: CoW 로 variant 가 갈렸으면 옵션값 조합이 같은 twin.
 * - **꺼야 하나**: 짝이 없거나, 조합이 모호하거나(같은 조합이 둘 이상 — 주문이 흘러갈 곳을
 *   임의로 고를 수 없다), 새 버전이 디지털인데 외부 마켓플레이스 리스팅일 때
 *   (`createListing` 이 거부하는 상태를 승계로 만들 수는 없다).
 *
 * 디지털 판정은 **CoW 여부와 무관**하다 — `fulfillmentKind` 만 바꿔 publish 하면 품목이
 * 복제되지 않으므로, 제자리 variant 의 리스팅도 검사해야 한다.
 */
export function planChannelListingReconciliation(
  candidateVariants: VariantOptionCombo[],
  newVariants: VariantOptionCombo[],
  listings: ReconcilableListing[],
  newVersionIsDigital: boolean,
): ChannelListingReconciliationPlan {
  const newVariantIds = new Set(newVariants.map((v) => v.variantId));

  // 같은 조합이 둘 이상이면 null 로 표시해 "짝 없음" 과 같게 취급한다.
  const newVariantIdByComboKey = new Map<string, string | null>();
  for (const nv of newVariants) {
    const key = comboKey(nv.optionValueIds);
    newVariantIdByComboKey.set(key, newVariantIdByComboKey.has(key) ? null : nv.variantId);
  }

  const listingsByVariantId = new Map<string, ReconcilableListing[]>();
  for (const listing of listings) {
    const bucket = listingsByVariantId.get(listing.variantId);
    if (bucket) bucket.push(listing);
    else listingsByVariantId.set(listing.variantId, [listing]);
  }

  const updates: ChannelListingReconciliationPlan['updates'] = [];

  for (const candidate of candidateVariants) {
    const affected = listingsByVariantId.get(candidate.variantId);
    if (!affected) continue;

    // 새 버전이 같은 variant 행을 그대로 쓰면 CoW 가 없었던 것 — 옮길 곳이 없다.
    const isStale = !newVariantIds.has(candidate.variantId);
    const twinVariantId = isStale
      ? (newVariantIdByComboKey.get(comboKey(candidate.optionValueIds)) ?? null)
      : null;

    for (const listing of affected) {
      const blockedByDigital = newVersionIsDigital && listing.isExternalMarketplace;
      const deactivate = listing.isActive && (blockedByDigital || (isStale && !twinVariantId));
      const newVariantId = isStale ? twinVariantId : null;

      // 이미 꺼진 리스팅을 다시 끄지 않고, 옮길 곳도 없으면 건드릴 이유가 없다.
      if (!deactivate && !newVariantId) continue;

      updates.push({ listingId: listing.id, newVariantId, deactivate });
    }
  }

  return { updates };
}
