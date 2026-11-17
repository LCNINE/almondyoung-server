"use client"

import { useEffect } from "react"

const DRAG_THRESHOLD_PX = 5

function findScrollableX(target: EventTarget | null): HTMLElement | null {
  let el = target instanceof Element ? target : null

  while (el && el !== document.body) {
    if (el instanceof HTMLElement && el.scrollWidth > el.clientWidth) {
      const { overflowX } = getComputedStyle(el)

      if (overflowX === "auto" || overflowX === "scroll") {
        return el
      }
    }

    el = el.parentElement
  }

  return null
}

// 가로 스크롤 레일은 터치로만 밀린다. 창을 좁힌 PC 에서도 마우스로 끌어 넘길 수 있게 문서 전체에 한 번 건다
export function MouseDragScroll() {
  useEffect(() => {
    let el: HTMLElement | null = null
    let startX = 0
    let startScroll = 0
    let dragged = false
    let snapType = ""

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || e.button !== 0) {
        return
      }

      if (
        (e.target as Element).closest(
          "input, textarea, select, [contenteditable], [data-no-drag-scroll]"
        )
      ) {
        return
      }

      el = findScrollableX(e.target)

      if (!el) {
        return
      }

      startX = e.clientX
      startScroll = el.scrollLeft
      dragged = false
    }

    const onPointerMove = (e: PointerEvent) => {
      if (!el) {
        return
      }

      const dx = e.clientX - startX

      if (!dragged) {
        if (Math.abs(dx) < DRAG_THRESHOLD_PX) {
          return
        }

        dragged = true
        snapType = el.style.scrollSnapType
        el.style.scrollSnapType = "none"
        el.style.cursor = "grabbing"
      }

      el.scrollLeft = startScroll - dx
    }

    const onPointerUp = () => {
      if (el && dragged) {
        el.style.scrollSnapType = snapType
        el.style.cursor = ""
      }

      el = null
    }

    // 끌고 난 뒤 손을 떼면 그 자리의 상품 링크가 눌리지 않게 한다
    const onClick = (e: MouseEvent) => {
      if (!dragged) {
        return
      }

      dragged = false
      e.preventDefault()
      e.stopPropagation()
    }

    const onDragStart = (e: DragEvent) => {
      if (el) {
        e.preventDefault()
      }
    }

    document.addEventListener("pointerdown", onPointerDown)
    document.addEventListener("pointermove", onPointerMove)
    document.addEventListener("pointerup", onPointerUp)
    document.addEventListener("click", onClick, true)
    document.addEventListener("dragstart", onDragStart)

    return () => {
      document.removeEventListener("pointerdown", onPointerDown)
      document.removeEventListener("pointermove", onPointerMove)
      document.removeEventListener("pointerup", onPointerUp)
      document.removeEventListener("click", onClick, true)
      document.removeEventListener("dragstart", onDragStart)
    }
  }, [])

  return null
}
