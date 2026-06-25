export type CartShippingPolicyItem = {
  requires_shipping?: boolean | null
  product_type?: string | null
}

export type CartShippingPolicyOption = {
  id: string
  type?: {
    code?: string | null
  } | null
}

export function itemRequiresShipping(item: CartShippingPolicyItem): boolean {
  if (typeof item.requires_shipping === "boolean") {
    return item.requires_shipping
  }

  return item.product_type !== "digital_sale"
}

export function cartRequiresShipping(
  items?: CartShippingPolicyItem[] | null
): boolean {
  return Boolean(items?.some(itemRequiresShipping))
}

// 디지털(배송 불필요) 라인 여부. requires_shipping === false 우선, 없으면 product_type === 'digital_sale'.
export function isDigitalItem(item: CartShippingPolicyItem): boolean {
  return !itemRequiresShipping(item)
}

export type DigitalProductInput = {
  metadata?: Record<string, unknown> | null
  type?: { value?: string | null } | null
}

// 상품 단위 디지털 여부(PDP/카드용). metadata.fulfillmentKind / requiresShipping 우선, type.value='digital_sale' fallback.
export function isDigitalProduct(product?: DigitalProductInput | null): boolean {
  if (!product) return false
  const meta = product.metadata ?? {}
  if (meta.fulfillmentKind === "digital") return true
  if (meta.requiresShipping === false) return true
  return product.type?.value === "digital_sale"
}

export function selectShippingOptionsForCart<
  T extends CartShippingPolicyOption,
>(options: T[] | null | undefined, items?: CartShippingPolicyItem[] | null): T[] {
  if (!cartRequiresShipping(items)) {
    return []
  }

  return (options ?? []).filter((option) => option.type?.code === "standard")
}
