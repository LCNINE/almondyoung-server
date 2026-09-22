"use client"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { updateMarketingConsent } from "@lib/api/users/consents"
import { formatDate } from "@/lib/utils/format-date"
import { useTranslations } from "next-intl"
import { useState, useTransition } from "react"
import { toast } from "sonner"

interface MarketingConsentSectionProps {
  initialEnabled: boolean
}

export function MarketingConsentSection({
  initialEnabled,
}: MarketingConsentSectionProps) {
  const t = useTranslations("mypage.account.marketing")
  const [enabled, setEnabled] = useState(initialEnabled)
  const [isPending, startTransition] = useTransition()

  const handleChange = (next: boolean) => {
    startTransition(async () => {
      try {
        const result = await updateMarketingConsent(next)
        setEnabled(result.marketingConsent)
        const date = formatDate(result.changedAt)
        toast.success(
          result.marketingConsent
            ? t("agreed", { date })
            : t("withdrawn", { date })
        )
      } catch (error: unknown) {
        const err = error as Error & { digest?: string }
        if (err.digest === "UNAUTHORIZED" || err.message === "UNAUTHORIZED") {
          throw error
        }
        toast.error(t("saveFailed"))
      }
    })
  }

  return (
    <Card id="marketing-consent">
      <CardHeader>
        <CardTitle className="text-lg">{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <label className="flex items-center justify-between gap-4">
          <span className="text-sm">{t("label")}</span>
          <Switch
            checked={enabled}
            onCheckedChange={handleChange}
            disabled={isPending}
          />
        </label>
      </CardContent>
    </Card>
  )
}
