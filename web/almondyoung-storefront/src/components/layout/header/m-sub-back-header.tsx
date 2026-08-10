"use client"

import { BackButton } from "@/components/shared/back-button"
import { useParams } from "next/navigation"

interface SubPageHeaderProps {
  /** 헤더에 표시될 페이지 제목 */
  title: string
  fallbackHref?: string
}

export default function MobileSubBackHeader({
  title,
  fallbackHref,
}: SubPageHeaderProps) {
  const params = useParams() as { countryCode?: string }
  const countryCode = params?.countryCode || "kr"

  return (
    <header className="fixed top-0 left-0 z-50 flex w-full items-center border-b-[0.5px] border-gray-200 bg-white px-3.5 py-3">
      <div className="flex flex-1 justify-start">
        <BackButton
          fallbackHref={fallbackHref || `/${countryCode}/mypage`}
          className="h-6 w-6 text-black"
          iconClassName="h-full w-full"
        />
      </div>

      <h1 className="flex-1 text-center font-['Pretendard'] text-base font-bold text-black">
        {title}
      </h1>

      <div className="flex-1" />
    </header>
  )
}
