/** core → channel-adapter 가 보내는 구성품 한 줄. 구성품·옵션은 PIM id 다. */
export type BundleOfferSyncItem = {
  addon_pim_master_id: string;
  allowed_pim_variant_ids: string[] | null;
  regular_rate_bp: number;
  membership_rate_bp: number;
  enabled: boolean;
  starts_at: string | null;
  ends_at: string | null;
  label: string | null;
  sort: number;
};

/** 쇼핑몰에 있는 구성품 상품. handle = PIM master id, 옵션 metadata.pimVariantId = PIM variant id. */
export type AddonProduct = {
  id: string;
  handle: string;
  variants: Array<{ id: string; pim_variant_id: string | null }>;
};

export type BundleOfferRow = {
  product_id: string;
  addon_product_id: string;
  addon_pim_master_id: string;
  allowed_variant_ids: string[] | null;
  regular_rate_bp: number;
  membership_rate_bp: number;
  enabled: boolean;
  starts_at: Date | null;
  ends_at: Date | null;
  label: string | null;
  sort: number;
};

export type BundleOfferSkipReason = 'addon_not_in_store' | 'addon_is_self' | 'no_allowed_variant_in_store';

export type BundleOfferSyncPlan = {
  rows: BundleOfferRow[];
  skipped: Array<{ addon_pim_master_id: string; reason: BundleOfferSkipReason }>;
};

/**
 * 상품(A) 하나의 구성품 목록을 쇼핑몰 id 로 바꾼다. 쇼핑몰에 없는 구성품은 그 줄만 빼고 이유를 남긴다
 * (구성품이 나중에 생기면 A 의 다음 발행이 다시 맞춘다).
 */
export function planBundleOfferSync(
  productId: string,
  items: BundleOfferSyncItem[],
  addonsByHandle: Map<string, AddonProduct>,
): BundleOfferSyncPlan {
  const plan: BundleOfferSyncPlan = { rows: [], skipped: [] };
  for (const item of items) {
    const addon = addonsByHandle.get(item.addon_pim_master_id);
    if (!addon) {
      plan.skipped.push({ addon_pim_master_id: item.addon_pim_master_id, reason: 'addon_not_in_store' });
      continue;
    }
    if (addon.id === productId) {
      plan.skipped.push({ addon_pim_master_id: item.addon_pim_master_id, reason: 'addon_is_self' });
      continue;
    }

    let allowed: string[] | null = null;
    if (item.allowed_pim_variant_ids) {
      const wanted = new Set(item.allowed_pim_variant_ids);
      allowed = addon.variants.filter((v) => v.pim_variant_id && wanted.has(v.pim_variant_id)).map((v) => v.id);
      if (allowed.length === 0) {
        plan.skipped.push({ addon_pim_master_id: item.addon_pim_master_id, reason: 'no_allowed_variant_in_store' });
        continue;
      }
    }

    plan.rows.push({
      product_id: productId,
      addon_product_id: addon.id,
      addon_pim_master_id: item.addon_pim_master_id,
      allowed_variant_ids: allowed,
      regular_rate_bp: item.regular_rate_bp,
      membership_rate_bp: item.membership_rate_bp,
      enabled: item.enabled,
      starts_at: item.starts_at ? new Date(item.starts_at) : null,
      ends_at: item.ends_at ? new Date(item.ends_at) : null,
      label: item.label,
      sort: item.sort,
    });
  }
  return plan;
}

/**
 * 이미 적용한 교체보다 오래된 교체인가. 리비전은 core 가 저장한 시각이다(이벤트와 발행 스냅샷이 같은 값을 싣는다).
 * 리비전이 없는 요청(옛 호출자)은 예전처럼 적용한다.
 */
export function isStaleBundleOfferSync(incoming: string | null | undefined, stored: Date | null): boolean {
  if (!incoming || !stored) return false;
  return new Date(incoming).getTime() < stored.getTime();
}
