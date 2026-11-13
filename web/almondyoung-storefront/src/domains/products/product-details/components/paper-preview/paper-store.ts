import { useSyncExternalStore } from "react"
import type { PaperVariant } from "./paper"

// 옵션 칸(구매 영역)에서 고른 용지를 대표 이미지의 3D 로 넘긴다. 둘은 형제 컴포넌트라 공통 상태가 따로 없다
type Picked = { productId: string; variant: PaperVariant }

let picked: Picked | null = null
const listeners = new Set<() => void>()

export function pickPaper(productId: string, variant: PaperVariant) {
  picked = { productId, variant }
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)

  return () => listeners.delete(listener)
}

export function usePickedPaper(
  productId: string,
  fallback: PaperVariant
): PaperVariant {
  const current = useSyncExternalStore(
    subscribe,
    () => picked,
    () => null
  )

  return current?.productId === productId ? current.variant : fallback
}
