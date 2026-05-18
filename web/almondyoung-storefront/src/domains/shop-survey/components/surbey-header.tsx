"use client"

import { useTranslations } from "next-intl"

export default function SurveyHeader() {
  const t = useTranslations("mypage.shopSetting")
  return (
    <header className="inline-flex w-full flex-col items-start justify-start gap-2.5 self-stretch bg-linear-to-l from-amber-300 to-amber-500 p-7">
      <span className="justify-start font-['Pretendard'] text-2xl font-bold text-white">
        {t("headerTitle")}
      </span>
      <span className="justify-start font-['Pretendard'] text-sm font-normal text-white">
        {t("headerDescription")}
      </span>
    </header>
  )
}
