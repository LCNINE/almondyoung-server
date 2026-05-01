"use client"

import { useRouter } from "next/navigation"

const KAKAO_CHANNEL_URL = "https://pf.kakao.com/_xaxgxazs"

export default function PriceErrorNotice() {
  const router = useRouter()

  const handleRefresh = () => {
    router.refresh()
  }

  return (
    <div className="flex items-center justify-between text-sm text-gray-400">
      <span>금액을 불러오지 못했어요</span>
      <div className="flex gap-3">
        <button
          onClick={handleRefresh}
          className="underline underline-offset-2 hover:text-gray-600"
        >
          새로고침
        </button>
        <a
          href={KAKAO_CHANNEL_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2 hover:text-gray-600"
        >
          문의
        </a>
      </div>
    </div>
  )
}
