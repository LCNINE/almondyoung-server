"use client"

import { Button } from "@components/common/ui/button"
import { Building2, Plus } from "lucide-react"
import { useTranslations } from "next-intl"

interface BusinessEmptyProps {
  onRegister: () => void
}

export default function BusinessEmpty({ onRegister }: BusinessEmptyProps) {
  const t = useTranslations("business.empty")

  return (
    <div className="border-border bg-muted/30 flex flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-16 text-center">
      <div className="bg-primary/10 mb-4 flex h-16 w-16 items-center justify-center rounded-full">
        <Building2 className="text-primary h-8 w-8" />
      </div>
      <h3 className="text-foreground mb-2 text-lg font-semibold">
        {t("title")}
      </h3>
      <Button onClick={onRegister} className="gap-2">
        <Plus className="h-4 w-4" />
        {t("registerButton")}
      </Button>
    </div>
  )
}
