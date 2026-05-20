"use client"

import { useEffect, useState } from "react"

/**
 * 카테고리 상품 그리드의 컬럼 수를 반응형으로 반환한다.
 * Tailwind 브레이크포인트(`grid-cols-2 lg:grid-cols-3 xl:grid-cols-4`)에 맞춰
 * xl(1280px↑)=4, lg(1024px↑)=3, 그 외 2.
 *
 * SSR/첫 렌더는 결정적 기본값(2)으로 고정해 hydration mismatch 를 피하고,
 * mount 후 matchMedia 로 실제 브레이크포인트를 반영한다.
 */
export function useGridColumns(): number {
  const [columns, setColumns] = useState(2)

  useEffect(() => {
    const xl = window.matchMedia("(min-width: 1280px)")
    const lg = window.matchMedia("(min-width: 1024px)")

    const update = () => {
      if (xl.matches) {
        setColumns(4)
      } else if (lg.matches) {
        setColumns(3)
      } else {
        setColumns(2)
      }
    }

    update()
    xl.addEventListener("change", update)
    lg.addEventListener("change", update)

    return () => {
      xl.removeEventListener("change", update)
      lg.removeEventListener("change", update)
    }
  }, [])

  return columns
}
