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

export function selectShippingOptionsForCart<
  T extends CartShippingPolicyOption,
>(options: T[] | null | undefined, items?: CartShippingPolicyItem[] | null): T[] {
  if (!cartRequiresShipping(items)) {
    return []
  }

  return (options ?? []).filter((option) => option.type?.code === "standard")
}
