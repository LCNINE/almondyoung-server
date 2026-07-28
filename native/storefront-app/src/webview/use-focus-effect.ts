import { useEffect } from "react"

/** 네비게이션 라이브러리 없이 마운트 동안만 구독을 유지한다. */
export function useFocusEffect(effect: () => () => void): void {
  useEffect(effect, [])
}
