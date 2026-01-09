"use client"

import { useRouter } from "next/navigation"
import _ from "lodash"

// todo: 백엔드에서 데이터를 가져오도록 수정
const HOT_KEYWORD_LIST = [
  { title: "비타민D", status: "up" },
  { title: "저당 젤리", status: "new" },
  { title: "식물성 단백질", status: "up" },
  { title: "아르기닌 6000", status: "down" },
  { title: "콜라겐 스틱", status: "new" },
  { title: "유산균", status: "up" },
  { title: "오메가3", status: "new" },
  { title: "다이어트 쉐이크", status: "up" },
  { title: "선크림", status: "down" },
  { title: "비타민C", status: "new" },
]

export function SearchHotKeyword() {
  const router = useRouter()

  // 데이터를 반으로 나눔 (예: 10개면 5개씩 2덩어리)
  const columns = _.chunk(
    HOT_KEYWORD_LIST,
    Math.ceil(HOT_KEYWORD_LIST.length / 2)
  )

  const handleHotKeywordClick = (item: string) => {
    router.push(`/search?q=${encodeURIComponent(item)}`)
  }

  return (
    <section>
      <div className="mb-6 flex items-center justify-between">
        <h3 className="text-base leading-none font-bold text-gray-900">
          급상승 검색어
        </h3>
        <span className="text-[12px] font-normal text-gray-400">
          08:00 기준
        </span>
      </div>

      <div className="grid grid-cols-2 gap-x-8 gap-y-2">
        {columns.map((col, colIdx) => (
          <div key={colIdx} className="flex flex-col gap-y-4">
            {col.map((item, itemIdx) => {
              // 전체 순서를 계산
              const overallIdx =
                colIdx * Math.ceil(HOT_KEYWORD_LIST.length / 2) + itemIdx

              return (
                <div
                  key={item.title}
                  className="flex cursor-pointer items-center gap-3 transition-opacity hover:opacity-70"
                  onClick={() => handleHotKeywordClick(item.title)}
                >
                  <span className="w-5 text-center font-black text-green-700 italic">
                    {overallIdx + 1}
                  </span>
                  <span className="flex-1 truncate text-[15px] font-medium text-gray-800">
                    {item.title}
                  </span>
                  <div className="flex w-8 justify-end">
                    {item.status === "new" ? (
                      <span className="rounded-sm bg-orange-100 px-1.5 py-0.5 text-[10px] font-bold text-orange-600">
                        NEW
                      </span>
                    ) : item.status === "up" ? (
                      <span className="text-[10px] text-red-500">▲</span>
                    ) : (
                      <span className="text-[10px] text-blue-500">▼</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </section>
  )
}
