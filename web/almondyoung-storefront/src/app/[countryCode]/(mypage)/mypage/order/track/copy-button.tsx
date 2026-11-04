"use client"

import { useTranslations } from "next-intl"
import { toast } from "sonner"

export function CopyButton({ value }: { value: string }) {
  const t = useTranslations("mypage.order.delivery")

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      toast.success(t("copied"))
    } catch {
      // clipboard 미지원 환경은 조용히 무시
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="bg-secondary ml-2 h-6 rounded-full px-2 text-xs font-medium"
    >
      {t("copy")}
    </button>
  )
}
