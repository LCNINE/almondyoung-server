"use client"

import { CustomButton } from "@/components/shared/custom-buttons/custom-button"
import {
  downloadOwnership,
  exerciseOwnership,
} from "@lib/api/library/library-api"
import type { DigitalAssetOwnership } from "@lib/types/ui/library.ui"
import { Download } from "lucide-react"
import { useTranslations } from "next-intl"
import { useState, useTransition } from "react"
import { toast } from "sonner"

export function OrderDigitalDownloads({
  ownerships,
}: {
  ownerships: DigitalAssetOwnership[]
}) {
  const t = useTranslations("mypage.order.digitalDownload")
  const [isPending, startTransition] = useTransition()
  const [busyId, setBusyId] = useState<string | null>(null)
  // exercise 직후에는 서버에서 받은 ownership 이 아직 옛 상태라 로컬로 기억한다.
  const [exercised, setExercised] = useState<Set<string>>(new Set())

  if (ownerships.length === 0) return null

  const handleDownload = (ownership: DigitalAssetOwnership) => {
    const alreadyExercised =
      !!ownership.exercisedAt || exercised.has(ownership.id)

    if (
      !alreadyExercised &&
      !window.confirm(t("confirm", { name: ownership.asset.name }))
    ) {
      return
    }

    setBusyId(ownership.id)
    startTransition(async () => {
      try {
        if (!alreadyExercised) {
          const exerciseResult = await exerciseOwnership(ownership.id)
          if (!exerciseResult.success) {
            toast.error(t("exerciseFailed"), {
              description: exerciseResult.message,
            })
            return
          }
          setExercised((prev) => new Set(prev).add(ownership.id))
        }

        const result = await downloadOwnership(ownership.id)
        if (!result.success) {
          toast.error(t("failed"), { description: result.message })
          return
        }

        // Core 가 준 S3 signed URL(강제 다운로드 disposition 포함)로 브라우저가 직접 받는다.
        const link = document.createElement("a")
        link.href = result.url
        link.rel = "noopener"
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)

        toast.success(t("started"), { description: result.filename })
      } catch (err: unknown) {
        const e = err as Error & { digest?: string }

        if (e.digest === "UNAUTHORIZED" || e.message === "UNAUTHORIZED") {
          throw err
        }

        toast.error(t("failed"))
      } finally {
        setBusyId(null)
      }
    })
  }

  return (
    <div className="border-border mt-2 border-t pt-4">
      <h3 className="text-foreground mb-3 text-base font-bold">{t("title")}</h3>
      <ul className="space-y-2">
        {ownerships.map((ownership) => {
          const busy = isPending && busyId === ownership.id
          return (
            <li
              key={ownership.id}
              className="flex items-center justify-between gap-3"
            >
              <span className="text-foreground min-w-0 flex-1 truncate text-sm">
                {ownership.asset.name}
              </span>
              <CustomButton
                variant="outline"
                color="secondary"
                size="sm"
                disabled={busy}
                onClick={() => handleDownload(ownership)}
              >
                <Download className="mr-1 h-4 w-4" />
                {busy ? t("downloading") : t("download")}
              </CustomButton>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
