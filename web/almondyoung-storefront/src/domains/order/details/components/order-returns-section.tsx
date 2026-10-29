"use client"

import { CustomButton } from "@/components/shared/custom-buttons/custom-button"
import { cancelReturn } from "@/lib/api/medusa/returns"
import type { CustomerReturn } from "@/lib/types/ui/returns"
import { DATE_FORMATS, formatDate } from "@/lib/utils/format-date"
import { useTranslations } from "next-intl"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { toast } from "sonner"
import { reasonLabelKey } from "../../return-request/return-reasons"
import { cancelRejectKey, returnItemRows, returnKindKey, returnStageKey } from "../order-returns-view"

interface OrderReturnsSectionProps {
  orderId: string
  returns: CustomerReturn[]
  items: Array<{ id: string; title: string; variantTitle: string | null }>
}

export function OrderReturnsSection({ orderId, returns, items }: OrderReturnsSectionProps) {
  const t = useTranslations("mypage.order.returns")
  const tReq = useTranslations("mypage.order.returnRequest")
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [armedId, setArmedId] = useState<string | null>(null)

  if (returns.length === 0) return null

  const text = (key: string, values?: Record<string, string | number>) =>
    t(key as Parameters<typeof t>[0], values as never)

  const onCancel = (ret: CustomerReturn) => {
    const { returnId } = ret
    if (armedId !== returnId) {
      setArmedId(returnId)
      return
    }
    startTransition(async () => {
      try {
        const outcome = await cancelReturn(orderId, returnId)
        setArmedId(null)
        if (outcome.kind === "canceled") {
          toast.success(ret.kind === "exchange" ? t("exchangeCancelDone") : t("cancelDone"))
          router.refresh()
          return
        }
        if (outcome.kind === "rejected") {
          toast.error(text(cancelRejectKey(outcome.reason, ret.kind)))
          router.refresh()
          return
        }
        toast.error(t("cancelFailed"))
      } catch (err: unknown) {
        // 인증 실패는 error.tsx 가 토큰 복구를 처리하도록 전파
        const e = err as { digest?: string; message?: string }
        if (e.digest === "UNAUTHORIZED" || e.message === "UNAUTHORIZED") throw err
        setArmedId(null)
        toast.error(t("cancelFailed"))
      }
    })
  }

  return (
    <section className="flex flex-col gap-3" aria-label={t("title")}>
      <h2 className="text-lg font-bold text-black">{t("title")}</h2>
      {returns.map((ret) => {
        const rows = returnItemRows(ret, items)
        const armed = armedId === ret.returnId
        return (
          <div key={ret.returnId} className="border-border space-y-2 rounded-lg border p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="flex items-center gap-2 text-sm font-medium text-black">
                <span className="rounded bg-secondary px-1.5 py-0.5 text-xs text-foreground">
                  {text(returnKindKey(ret.kind))}
                </span>
                {text(returnStageKey(ret.stage, ret.kind))}
              </p>
              <p className="text-xs text-gray-500">{formatDate(ret.requestedAt, DATE_FORMATS.KO_DOT)}</p>
            </div>
            <ul className="space-y-1">
              {rows.map((row, idx) => (
                <li key={`${ret.returnId}-${idx}`} className="text-sm text-gray-700">
                  {row.title}
                  {row.variantTitle && row.variantTitle !== "Default" ? ` - ${row.variantTitle}` : ""}
                  {" · "}
                  {t("quantity", { count: row.quantity })}
                </li>
              ))}
            </ul>
            <p className="text-xs text-gray-500">
              {t("reasonLabel")}: {tReq(reasonLabelKey(ret.reason) as Parameters<typeof tReq>[0])}
            </p>
            {ret.canCancel && (
              <div className="flex items-center gap-2">
                <CustomButton
                  variant="outline"
                  color="secondary"
                  size="sm"
                  onClick={() => onCancel(ret)}
                  isLoading={isPending && armed}
                  disabled={isPending}
                >
                  {ret.kind === "exchange" ? t("exchangeCancel") : t("cancel")}
                </CustomButton>
                {armed && !isPending && <p className="text-xs text-gray-500">{t("cancelConfirm")}</p>}
              </div>
            )}
          </div>
        )
      })}
    </section>
  )
}
