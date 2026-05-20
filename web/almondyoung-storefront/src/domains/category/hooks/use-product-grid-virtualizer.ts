"use client"

import { useGridColumns } from "@/hooks/ui/use-grid-columns"
import { useWindowVirtualizer } from "@tanstack/react-virtual"
import { useEffect, useRef, useState } from "react"

// 그리드 가로 간격(gap-x-6 = 24px)
const GAP_X = 24
// 정사각 이미지 아래 영역의 고정 높이: mt-4 + 상품명/평점/가격/수량 + 행 간격.
// 컬럼 폭이 정해지면 행 높이 = 이미지 높이(= 카드 폭) + 이 값.
const CARD_META_HEIGHT = 190
// 컨테이너 폭을 아직 모를 때(초기 렌더)의 행 높이 fallback.
const ESTIMATED_ROW_HEIGHT = 360

type UseProductGridVirtualizerParams = {
  itemCount: number
  hasNextPage: boolean
  isFetchingNextPage: boolean
  onLoadMore: () => void
}

/**
 * 반응형 그리드 상품 목록을 행(row) 단위로 가상화한다.
 * - 컬럼 수는 화면 폭에 따라(useGridColumns) 2/3/4로 바뀐다.
 * - 행 높이는 컨테이너 폭으로 미리 계산해 고정하므로 스크롤 중 출렁이지 않는다.
 * - 마지막 행 근처에 도달하면 onLoadMore 로 다음 페이지를 요청한다.
 */
export function useProductGridVirtualizer({
  itemCount,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
}: UseProductGridVirtualizerParams) {
  const columns = useGridColumns()

  const rowCount = Math.ceil(itemCount / columns)
  const totalRowCount = hasNextPage ? rowCount + 1 : rowCount

  const listRef = useRef<HTMLDivElement>(null)
  const [scrollMargin, setScrollMargin] = useState(0)
  const [containerWidth, setContainerWidth] = useState(0)

  // 컨테이너의 문서상 위치(scrollMargin)와 폭을 측정한다. 리사이즈 때만 갱신되고
  // 스크롤 중에는 바뀌지 않으므로, 고정 행 높이와 함께 쓰면 스크롤이 출렁이지 않는다.
  useEffect(() => {
    const el = listRef.current
    if (!el) return

    const measure = () => {
      setScrollMargin(el.offsetTop)
      setContainerWidth(el.offsetWidth)
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // 카드 폭(= 정사각 이미지 높이)을 컬럼 수로 계산해 행 높이를 고정한다.
  const cardWidth =
    containerWidth > 0 ? (containerWidth - (columns - 1) * GAP_X) / columns : 0
  const rowHeight =
    cardWidth > 0 ? cardWidth + CARD_META_HEIGHT : ESTIMATED_ROW_HEIGHT

  const virtualizer = useWindowVirtualizer({
    count: totalRowCount,
    estimateSize: () => rowHeight,
    overscan: 4,
    scrollMargin,
  })

  const virtualItems = virtualizer.getVirtualItems()

  // 컬럼 수나 행 높이가 바뀌면 가상화 계산을 다시 한다.
  useEffect(() => {
    virtualizer.measure()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns, rowHeight])

  // 마지막 행 근처에 도달하면 다음 페이지를 로드한다.
  useEffect(() => {
    const last = virtualItems[virtualItems.length - 1]
    if (!last) return
    if (last.index >= rowCount - 1 && hasNextPage && !isFetchingNextPage) {
      onLoadMore()
    }
  }, [virtualItems, rowCount, hasNextPage, isFetchingNextPage, onLoadMore])

  return { listRef, virtualizer, virtualItems, columns, rowCount, rowHeight }
}
