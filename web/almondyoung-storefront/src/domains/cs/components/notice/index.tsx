"use client"

import { ChevronRight } from "lucide-react"
import { useState } from "react"

interface NoticeItem {
  id: string
  title: string
  content: string
  date: string
  isImportant: boolean
}

const NOTICE_DATA: NoticeItem[] = [
  {
    id: "1",
    title: "[공지] 2024년 설 연휴 배송 안내",
    content:
      "안녕하세요. 아몬드영입니다.\n\n설 연휴 기간 중 배송 일정을 안내드립니다.\n\n• 연휴 전 마지막 출고일: 2월 7일(수)\n• 연휴 기간: 2월 8일(목) ~ 2월 12일(월)\n• 배송 재개일: 2월 13일(화)\n\n연휴 기간 중에도 주문은 가능하며, 순차적으로 출고될 예정입니다.\n감사합니다.",
    date: "2024.01.25",
    isImportant: true,
  },
  {
    id: "2",
    title: "[공지] 개인정보처리방침 변경 안내",
    content:
      "안녕하세요. 아몬드영입니다.\n\n개인정보처리방침이 일부 변경되어 안내드립니다.\n\n주요 변경 사항:\n• 개인정보 수집 항목 변경\n• 개인정보 보유 기간 변경\n\n변경된 방침은 2024년 2월 1일부터 적용됩니다.\n자세한 내용은 개인정보처리방침 페이지를 확인해주세요.\n\n감사합니다.",
    date: "2024.01.20",
    isImportant: false,
  },
  {
    id: "3",
    title: "[공지] 신규 결제 수단 추가 안내",
    content:
      "안녕하세요. 아몬드영입니다.\n\n고객님의 편의를 위해 새로운 결제 수단을 추가했습니다.\n\n추가된 결제 수단:\n• 토스페이\n• 페이코\n\n더욱 편리한 쇼핑을 즐겨주세요.\n감사합니다.",
    date: "2024.01.15",
    isImportant: false,
  },
]

export function Notice() {
  const [selectedNotice, setSelectedNotice] = useState<string | null>(null)

  const selectedItem = NOTICE_DATA.find((item) => item.id === selectedNotice)

  if (selectedItem) {
    return (
      <div className="px-4 py-6">
        <button
          onClick={() => setSelectedNotice(null)}
          className="mb-4 flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
        >
          <ChevronRight className="h-4 w-4 rotate-180" />
          <span>목록으로</span>
        </button>
        <div className="rounded-lg border border-gray-200 p-4">
          <div className="mb-2 flex items-center gap-2">
            {selectedItem.isImportant && (
              <span className="rounded bg-red-500 px-2 py-0.5 text-xs font-medium text-white">
                중요
              </span>
            )}
            <span className="text-xs text-gray-400">{selectedItem.date}</span>
          </div>
          <h2 className="mb-4 text-lg font-bold">{selectedItem.title}</h2>
          <p className="whitespace-pre-line text-sm leading-relaxed text-gray-600">
            {selectedItem.content}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="px-4 py-6">
      <h2 className="mb-4 text-lg font-bold">공지사항</h2>
      <div className="divide-y divide-gray-100 rounded-lg border border-gray-200">
        {NOTICE_DATA.map((item) => (
          <button
            key={item.id}
            onClick={() => setSelectedNotice(item.id)}
            className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:text-[#f29219]"
          >
            <div className="flex-1">
              <div className="mb-1 flex items-center gap-2">
                {item.isImportant && (
                  <span className="rounded bg-red-500 px-1.5 py-0.5 text-[10px] font-medium text-white">
                    중요
                  </span>
                )}
                <span className="text-xs text-gray-400">{item.date}</span>
              </div>
              <p className="line-clamp-1 text-sm font-medium">{item.title}</p>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />
          </button>
        ))}
      </div>
    </div>
  )
}
