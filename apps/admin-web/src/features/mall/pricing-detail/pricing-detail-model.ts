import type { PricingRuleInput, VariantDto } from '@/lib/types/dto/products';

export type PricingVariant = {
  id: string;
  name: string;
};

type VersionVariantForPricing = {
  id: string;
  variantName: string | null;
};

export function toPricingVariantsFromMaster(
  variants: VariantDto[]
): PricingVariant[] {
  return variants.map((variant) => ({
    id: variant.id,
    name:
      (variant as VariantDto & { variantName?: string | null }).variantName ||
      variant.name ||
      variant.id,
  }));
}

export function toPricingVariantsFromVersion(
  variants: VersionVariantForPricing[]
): PricingVariant[] {
  return variants.map((variant) => ({
    id: variant.id,
    name: variant.variantName || variant.id,
  }));
}

export function selectPricingVariants({
  selectedVersionId,
  masterVariants,
  versionVariants,
}: {
  selectedVersionId: string | null;
  masterVariants: PricingVariant[];
  versionVariants: PricingVariant[];
}): PricingVariant[] {
  if (selectedVersionId) {
    return versionVariants;
  }
  return masterVariants;
}

export function getValidPricingVariantId(
  variantId: string,
  variants: PricingVariant[]
): string {
  if (!variantId) return '';
  return variants.some((variant) => variant.id === variantId) ? variantId : '';
}

/**
 * 옵션값/옵션조합 범위의 룰은 적용 대상(scopeTargetIds)이 1개 이상 있어야 저장된다.
 * 하나라도 대상이 비어 있으면 true — 저장을 막고 사용자에게 안내하기 위한 가드.
 */
export function hasRuleMissingScopeTarget(rules: PricingRuleInput[]): boolean {
  return rules.some(
    (rule) =>
      (rule.scopeType === 'with_option' || rule.scopeType === 'variants') &&
      (rule.scopeTargetIds === undefined || rule.scopeTargetIds.length === 0)
  );
}
