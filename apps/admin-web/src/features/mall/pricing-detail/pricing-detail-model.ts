import type { VariantDto } from '@/lib/types/dto/products';

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
