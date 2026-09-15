import { HttpTypes } from "@medusajs/types"

/**
 * 품절 옵션들 중 가장 이른 입고예정일을 고른다.
 *
 * 데이터(variant.metadata.inboundDate)는 미수령 수량이 남은 core 발주 라인 →
 * Medusa variant.metadata 동기화로 채워진다 (sync-restock-to-medusa.ts).
 * 없으면 null → 아무것도 렌더하지 않는다.
 *
 * 지난 날짜는 후보에서 뺀다. 동기화가 stale 값을 남기면(입고완료/취소 후 미삭제)
 * "재입고 : 2026년 7월 14일 예정" 처럼 이미 지난 날을 안내하게 된다. 그 경우엔
 * 안내를 아예 안 띄우고 일반 품절로 보여주는 편이 맞다.
 */
export function pickEarliestRestock(
  variants: (HttpTypes.StoreProductVariant | undefined)[]
) {
  const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
  const candidates = variants
    .map((v) => {
      const date = v?.metadata?.inboundDate
      if (typeof date !== "string" || !date) return null
      if (date.slice(0, 10) < today) return null // 지난 입고예정일 = stale
      return { date, approximate: Boolean(v?.metadata?.inboundApproximate) }
    })
    .filter((x): x is { date: string; approximate: boolean } => x !== null)

  if (candidates.length === 0) return null
  // ISO/`YYYY-MM-DD` 문자열은 사전순 = 시간순
  candidates.sort((a, b) => a.date.localeCompare(b.date))
  return candidates[0]
}
