import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselApi,
} from "@/components/ui/carousel"
import { cn } from "@lib/utils"
import React, { createContext, useContext, useState, useEffect } from "react"

const CarouselContext = createContext<any>(null)

export function ProductCarousel({
  children,
  opts,
  className,
}: {
  children: React.ReactNode
  opts?: any
  className?: string
}) {
  const [api, setApi] = useState<CarouselApi>()
  const [current, setCurrent] = useState(0)
  const [count, setCount] = useState(0)

  useEffect(() => {
    if (!api) return

    // 도트 개수와 현재 위치를 업데이트하는 함수
    const updateState = () => {
      setCount(api.scrollSnapList().length)
      setCurrent(api.selectedScrollSnap())
    }

    // 초기 로드 시 실행
    updateState()

    api.on("select", updateState) // 슬라이드 변경 시
    api.on("reInit", updateState) // 브라우저 사이즈 변경 등으로 재설정될 때

    return () => {
      api.off("select", updateState)
      api.off("reInit", updateState)
    }
  }, [api])

  return (
    <CarouselContext.Provider value={{ api, current, count }}>
      <Carousel setApi={setApi} opts={opts} className={cn("w-full", className)}>
        {children}
      </Carousel>
    </CarouselContext.Provider>
  )
}

ProductCarousel.List = function List({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <CarouselContent className={cn("", className)}>{children}</CarouselContent>
  )
}

ProductCarousel.Item = function Item({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return <CarouselItem className={cn("", className)}>{children}</CarouselItem>
}

ProductCarousel.Indicator = function Indicator({
  className,
  itemsPerGroup = 3, // 한 화면에 보여줄 아이템 수 (기본값 3)
}: {
  className?: string
  itemsPerGroup?: number
}) {
  const context = useContext(CarouselContext)
  if (!context || context.count <= 1) return null

  const { api, current, count } = context

  // 전체 아이템을 그룹 단위로 나눈 개수 (예: 12개 아이템 / 3 = 4개의 도트)
  const dotCount = Math.ceil(count / itemsPerGroup)

  // 현재 선택된 아이템 인덱스를 바탕으로 현재 어떤 도트가 활성화될지 계산
  const activeDotIndex = Math.floor(current / itemsPerGroup)

  return (
    <div className={cn("mt-6 flex justify-center gap-1.5", className)}>
      {Array.from({ length: dotCount }).map((_, i) => (
        <button
          key={i}
          onClick={() => api?.scrollTo(i * itemsPerGroup)} // 도트 클릭 시 해당 그룹 첫 장으로 이동
          className={cn(
            "h-1.5 rounded-full transition-all duration-300",
            activeDotIndex === i ? "w-4 bg-black" : "w-1.5 bg-gray-200"
          )}
          aria-label={`Go to group ${i + 1}`}
        />
      ))}
    </div>
  )
}
