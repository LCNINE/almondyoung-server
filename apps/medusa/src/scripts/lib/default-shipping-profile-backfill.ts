export type BackfillProduct = {
  id: string;
  handle?: string | null;
  metadata?: Record<string, unknown> | null;
  shipping_profile?: { id?: string | null } | null;
  is_giftcard?: boolean | null;
};

export type ShippingProfileUpdate = {
  id: string;
  shipping_profile_id: string;
};

export function isPhysicalPimProductMissingShippingProfile(product: BackfillProduct): boolean {
  const pimMasterId = product.metadata?.pimMasterId;
  if (typeof pimMasterId !== 'string' || pimMasterId.length === 0) {
    return false;
  }

  if (product.is_giftcard === true) {
    return false;
  }

  const fulfillmentKind = product.metadata?.fulfillmentKind;
  if (fulfillmentKind === 'digital') {
    return false;
  }

  return !product.shipping_profile?.id;
}

export function buildDefaultShippingProfileUpdates(
  products: BackfillProduct[],
  shippingProfileId: string,
): ShippingProfileUpdate[] {
  return products.filter(isPhysicalPimProductMissingShippingProfile).map((product) => ({
    id: product.id,
    shipping_profile_id: shippingProfileId,
  }));
}
