"use client"

import { useTranslations } from "next-intl"
import { useRouter } from "next/navigation"

const KAKAO_CHANNEL_URL = "https://pf.kakao.com/_xaxgxazs"

export default function PriceErrorNotice() {
  const router = useRouter()
  const t = useTranslations("cart.priceError")

  const handleRefresh = () => {
    router.refresh()
  }

  return (
    <div className="flex items-center justify-between text-sm text-gray-400">
      <span>{t("message")}</span>
      <div className="flex gap-3">
        <button
          onClick={handleRefresh}
          className="underline underline-offset-2 hover:text-gray-600"
        >
          {t("refresh")}
        </button>
        <a
          href={KAKAO_CHANNEL_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2 hover:text-gray-600"
        >
          {t("inquiry")}
        </a>
      </div>
    </div>
  )
}
