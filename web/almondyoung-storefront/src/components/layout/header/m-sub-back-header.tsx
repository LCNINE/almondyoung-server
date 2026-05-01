"use client" // 1. Next.js 13+ App Router에서 훅을 사용하기 위해 필요

import { ArrowLeft } from "lucide-react"
import { useRouter } from "next/navigation" // 2. next/navigation에서 useRouter 임포트

interface SubPageHeaderProps {
  /** 헤더에 표시될 페이지 제목 */
  title: string
}

export default function MobileSubBackHeader({ title }: SubPageHeaderProps) {
  // 3. useRouter 훅을 사용해 router 객체 가져오기
  const router = useRouter()

  // 4. 뒤로가기 핸들러 함수 정의
  const handleGoBack = () => {
    router.back()
  }

  return (
    <header className="fixed top-0 left-0 z-50 flex w-full items-center border-b-[0.5px] border-gray-200 bg-white px-3.5 py-3">
      {/* 좌측: 뒤로가기 버튼 */}
      <div className="flex flex-1 justify-start">
        <button
          type="button"
          aria-label="뒤로 가기"
          className="h-6 w-6 text-black"
          onClick={handleGoBack} // 5. onClick 이벤트에 핸들러 연결
        >
          <ArrowLeft className="h-full w-full" />
        </button>
      </div>

      {/* 중앙: 페이지 제목 */}
      <h1 className="flex-1 text-center font-['Pretendard'] text-base font-bold text-black">
        {title}
      </h1>

      {/* 우측: 공간 확보 */}
      <div className="flex-1" />
    </header>
  )
}
