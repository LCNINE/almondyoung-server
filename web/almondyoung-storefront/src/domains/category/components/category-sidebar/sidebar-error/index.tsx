"use client"

import { Button } from "@/components/ui/button"
import { AlertCircle, RefreshCw } from "lucide-react"
import { useTranslations } from "next-intl"

export function SidebarError() {
  const t = useTranslations("category.sidebar")

  const handleRetry = () => {
    window.location.reload()
  }

  return (
    <nav className="border-border w-full rounded-2xl border p-6 px-7 py-10 font-['Pretendard']">
      <h2 className="text-lg font-bold text-stone-900">{t("title")}</h2>
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <AlertCircle className="text-destructive h-8 w-8" />
        <p className="text-muted-foreground text-sm">{t("errorTitle")}</p>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleRetry}
          className="text-primary"
        >
          <RefreshCw className="mr-1 h-3 w-3" />
          {t("retry")}
        </Button>
      </div>
    </nav>
  )
}
