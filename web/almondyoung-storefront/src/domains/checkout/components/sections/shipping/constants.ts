export const SHIPPING_MEMO_OPTIONS = [
  { value: "door", label: "문 앞에 놓아주세요" },
  { value: "security", label: "경비실에 맡겨주세요" },
  { value: "parcel-box", label: "택배함에 넣어주세요" },
  { value: "direct", label: "직접 받겠습니다" },
  { value: "other", label: "기타 (직접 입력)" },
] as const

export type ShippingMemoValue = (typeof SHIPPING_MEMO_OPTIONS)[number]["value"]

export const DEBOUNCE_DELAY = 800
