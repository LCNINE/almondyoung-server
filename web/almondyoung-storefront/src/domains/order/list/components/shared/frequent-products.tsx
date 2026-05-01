"use client"

import Link from "next/link"

const FREQUENT_PRODUCTS = [
  {
    id: 1,
    images: [
      "https://via.placeholder.com/60x80",
      "https://via.placeholder.com/60x80",
      "https://via.placeholder.com/60x80",
    ],
  },
  {
    id: 2,
    images: [
      "https://via.placeholder.com/60x80",
      "https://via.placeholder.com/60x80",
      "https://via.placeholder.com/60x80",
    ],
  },
  {
    id: 3,
    images: [
      "https://via.placeholder.com/60x80",
      "https://via.placeholder.com/60x80",
      "https://via.placeholder.com/60x80",
    ],
  },
]

export function FrequentProducts() {
  return (
    <section className="bg-mute mb-4 px-[15px] py-[10px]">
      <div className="rounded-[10px] bg-white">
        {/* inner: 내부 여백 전담 */}
        <div className="flex h-20 items-center justify-between self-stretch rounded-[5px] bg-white px-5 shadow-[2px_2px_2px_0px_rgba(0,0,0,0.10)] outline-[0.50px] outline-zinc-300">
          <div className="relative h-9 w-16">
            <div className="absolute top-0 left-0 justify-start font-['Pretendard'] text-xs leading-4 font-normal text-black">
              자주 산 상품
            </div>
            <div className="absolute top-[20px] left-0 justify-start font-['Pretendard'] text-xs leading-4 font-normal text-amber-500">
              더보기
            </div>
          </div>
          <div className="flex items-center justify-start gap-2">
            <img
              className="h-12 w-12 rounded-[5px]"
              src="https://placehold.co/50x50"
            />
            <img
              className="h-12 w-12 rounded-[5px]"
              src="https://placehold.co/50x50"
            />
            <img
              className="h-12 w-12 rounded-[5px]"
              src="https://placehold.co/50x50"
            />
          </div>
        </div>
      </div>
    </section>
  )
}
