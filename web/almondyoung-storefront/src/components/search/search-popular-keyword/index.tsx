"use client"

import {
  Carousel,
  CarouselContent,
  CarouselItem,
} from "@/components/ui/carousel"
import { useRouter } from "next/navigation"
import chunk from "lodash/chunk"

// todo: 백엔드에서 데이터를 가져오도록 수정
const RECOMMEND_LIST = [
  "퍼마",
  "펌제",
  "노몬드",
  "롤리킹",
  "국가고시",
  "네일",
  "헤어",
  "샴푸",
  "로레알",
  "데미",
  "클리닉",
  "가발",
]

export function SearchPopularKeyword() {
  const router = useRouter()

  const handleHistoryClick = (item: string) => {
    router.push(`/search?q=${encodeURIComponent(item)}`)
  }

  // 데이터를 2개씩 묶어주는 로직 (두 줄 배치를 위해)
  const rows = chunk(RECOMMEND_LIST, 2)

  return (
    <>
      <h3 className="text-base leading-none font-bold text-gray-900">
        추천 검색어
      </h3>
      <Carousel opts={{ align: "start", dragFree: true }} className="w-full">
        <CarouselContent className="-ml-2 py-4">
          {rows.map((pair, idx) => (
            <CarouselItem key={`column-${idx}`} className="basis-auto pl-2">
              <div className="flex flex-col gap-2">
                {pair.map((item) => (
                  <div
                    key={item}
                    className="cursor-pointer rounded-full border border-gray-200 bg-white px-5 py-1 text-center text-xs font-medium whitespace-nowrap text-gray-500"
                    onClick={() => handleHistoryClick(item)}
                  >
                    {item}
                  </div>
                ))}
              </div>
            </CarouselItem>
          ))}
        </CarouselContent>
      </Carousel>{" "}
    </>
  )
}
