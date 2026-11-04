export type CartLineLike = {
  id: string
  variant_id?: string | null
  quantity: number
  metadata?: Record<string, unknown> | null
}

const isEmpty = (metadata: Record<string, unknown> | null | undefined) =>
  !metadata || Object.keys(metadata).length === 0

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const deepEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) return true
  if (!isRecord(a) || !isRecord(b)) return false
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  if (aKeys.length !== bKeys.length) return false
  return aKeys.every((key) => bKeys.includes(key) && deepEqual(a[key], b[key]))
}

/**
 * 새로 담는 아이템이 합쳐질 기존 라인. Medusa 가 담기 때 합치는 조건(같은 variant + 같은 metadata)과 같다.
 *
 * Medusa 는 합칠 때 수량만 더하고 단가는 «새로 담은 수량» 기준으로 남겨, 나눠 담으면 수량 할인가가
 * 빠진다. 합쳐질 라인을 미리 찾아 수량 수정으로 보내면 Medusa 가 합친 수량으로 다시 가격을 매긴다.
 */
export function findMergeableLine<T extends CartLineLike>(
  items: T[] | null | undefined,
  variantId: string,
  metadata?: Record<string, unknown>
): T | null {
  return (
    items?.find(
      (item) =>
        item.variant_id === variantId &&
        (isEmpty(item.metadata) && isEmpty(metadata)
          ? true
          : deepEqual(item.metadata ?? {}, metadata ?? {}))
    ) ?? null
  )
}
