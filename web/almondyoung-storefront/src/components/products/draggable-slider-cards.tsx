import React, { useState, useRef, ReactNode, MouseEvent } from "react"

// 컴포넌트의 props 타입을 정의합니다.
interface DraggableSliderProps {
  title: string
  children: ReactNode // 슬라이더에 들어갈 아이템들
}

export default function DraggableSliderCards({
  title,
  children,
}: DraggableSliderProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [startX, setStartX] = useState(0)
  const [scrollLeft, setScrollLeft] = useState(0)

  const onMouseDown = (e: MouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    if (!scrollRef.current) return
    setIsDragging(true)
    setStartX(e.pageX - scrollRef.current.offsetLeft)
    setScrollLeft(scrollRef.current.scrollLeft)
  }
  const onMouseUpOrLeave = () => setIsDragging(false)
  const onMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    if (!isDragging || !scrollRef.current) return
    e.preventDefault()
    const x = e.pageX - scrollRef.current.offsetLeft
    const walk = (x - startX) * 2
    scrollRef.current.scrollLeft = scrollLeft - walk
  }
  return (
    <section className="bg-white p-4">
      <h3 className="mb-4 text-lg font-bold">{title}</h3>
      <div
        ref={scrollRef}
        onMouseDown={onMouseDown}
        onMouseUp={onMouseUpOrLeave}
        onMouseLeave={onMouseUpOrLeave}
        onMouseMove={onMouseMove}
        className={`scrollbar-hide flex cursor-grab overflow-x-auto scroll-smooth pb-4 ${isDragging ? "cursor-grabbing" : ""}`}
      >
        {children}
      </div>
    </section>
  )
}
