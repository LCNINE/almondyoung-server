import { CarouselApi } from "@/components/ui/carousel"
import { useEffect, useRef, useState } from "react"

export function useCategoryBest(initialActiveTab: string) {
  const [activeTab, setActiveTab] = useState(initialActiveTab)
  const [api, setApi] = useState<CarouselApi>()
  const [current, setCurrent] = useState(0)
  const [count, setCount] = useState(0)

  // 탭 드래그 스크롤 로직
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

  // Carousel 상태 업데이트
  useEffect(() => {
    if (!api) return

    const onSelect = () => {
      setCurrent(api.selectedScrollSnap())
    }

    const onReInit = () => {
      setCount(api.scrollSnapList().length)
      setCurrent(api.selectedScrollSnap())
    }

    onReInit()

    api.on("select", onSelect)
    api.on("reInit", onReInit)

    return () => {
      api.off("select", onSelect)
      api.off("reInit", onReInit)
    }
  }, [api])

  return {
    activeTab,
    setActiveTab,
    carousel: {
      setApi,
      current,
      count,
    },
    dragHandlers: {
      ref: scrollRef,
      onMouseDown: onDragStart,
      onMouseMove: onDragMove,
      onMouseUp: onDragEnd,
      onMouseLeave: onDragEnd,
    },
  }
}
