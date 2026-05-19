export const SHIPPING_MEMO_OPTIONS = [
  { value: "door", labelKey: "door" },
  { value: "security", labelKey: "security" },
  { value: "parcel-box", labelKey: "parcelBox" },
  { value: "direct", labelKey: "direct" },
  { value: "other", labelKey: "other" },
] as const

export type ShippingMemoValue = (typeof SHIPPING_MEMO_OPTIONS)[number]["value"]
export type ShippingMemoLabelKey =
  (typeof SHIPPING_MEMO_OPTIONS)[number]["labelKey"]

export const DEBOUNCE_DELAY = 800
