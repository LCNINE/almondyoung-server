import { useRef, useState } from "react"

export function useDraggableScroll() {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [isDrag, setIsDrag] = useState(false)
  const [startX, setStartX] = useState(0)
  const [scrollLeft, setScrollLeft] = useState(0)

  const onDragStart = (e: React.MouseEvent) => {
    if (!scrollRef.current) return
    setIsDrag(true)
    setStartX(e.pageX - scrollRef.current.offsetLeft)
    setScrollLeft(scrollRef.current.scrollLeft)
  }

  const onDragEnd = () => {
    setIsDrag(false)
  }

  const onDragMove = (e: React.MouseEvent) => {
    if (!isDrag || !scrollRef.current) return
    e.preventDefault()
    const x = e.pageX - scrollRef.current.offsetLeft
    const walk = (x - startX) * 2 // 스크롤 속도 조절
    scrollRef.current.scrollLeft = scrollLeft - walk
  }

  return {
    props: {
      ref: scrollRef,
      onMouseDown: onDragStart,
      onMouseMove: onDragMove,
      onMouseUp: onDragEnd,
      onMouseLeave: onDragEnd,
    },
    isDrag,
  }
}
