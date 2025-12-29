import currency from "currency.js"

// 9000 → 9,000
export function formatPrice(value: number | null | undefined): string {
  return currency(value || 0, {
    precision: 0,
    separator: ",",
  }).value.toLocaleString("ko-KR")
}
