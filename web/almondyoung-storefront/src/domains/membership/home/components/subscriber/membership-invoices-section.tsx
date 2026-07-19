"use client"

import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { DATE_FORMATS, formatDate } from "@/lib/utils/format-date"
import { getMyInvoices, retryInvoicePaymentAction } from "@/lib/api/wallet"
import type { MyInvoiceDto, MyInvoiceStatus } from "@lib/types/dto/wallet"

const STATUS_COLOR: Record<MyInvoiceStatus, string> = {
  PAID: "text-green-600 bg-green-50",
  OPEN: "text-blue-600 bg-blue-50",
  ATTEMPTING: "text-blue-600 bg-blue-50",
  MANDATE_PENDING: "text-yellow-600 bg-yellow-50",
  PAST_DUE: "text-red-500 bg-red-50",
  UNCOLLECTIBLE: "text-red-500 bg-red-50",
  MANDATE_REJECTED: "text-red-500 bg-red-50",
  VOID: "text-gray-500 bg-gray-100",
  DRAFT: "text-gray-500 bg-gray-100",
}

/**
 * 고객 본인 멤버십 인보이스(정기결제 청구) 목록. 구독 계약이 없으면(빈 배열) 섹션 자체를 숨긴다.
 * 미납(PAST_DUE)만 즉시 재시도 CTA 를 노출 — 심사대기/진행중은 재시도해도 소용없으므로 표시만.
 */
export default function MembershipInvoicesSection() {
  const t = useTranslations("mypage.membership")
  const router = useRouter()
  const [invoices, setInvoices] = useState<MyInvoiceDto[] | null>(null)
  const [retryingId, setRetryingId] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  useEffect(() => {
    let active = true
    getMyInvoices().then((rows) => {
      if (active) setInvoices(rows)
    })
    return () => {
      active = false
    }
  }, [])

  const handleRetry = (invoiceId: string) => {
    setRetryingId(invoiceId)
    startTransition(async () => {
      try {
        await retryInvoicePaymentAction(invoiceId)
        toast.success(t("invoices.retrySuccess"))
        const rows = await getMyInvoices()
        setInvoices(rows)
        router.refresh()
      } catch (error) {
        const err = error as Error & { digest?: string }
        if (err?.digest === "UNAUTHORIZED" || err?.message === "UNAUTHORIZED") throw error
        toast.error(t("invoices.retryError"))
      } finally {
        setRetryingId(null)
      }
    })
  }

  // 로딩 중이거나 인보이스가 없으면(레거시 CHARGE 회원 포함) 섹션 숨김.
  if (!invoices || invoices.length === 0) return null

  return (
    <section className="mb-2 rounded-xl border border-gray-200 bg-white p-4">
      <h3 className="mb-3 text-sm font-semibold text-gray-800">{t("invoices.title")}</h3>
      <ul className="flex flex-col gap-2">
        {invoices.map((inv) => (
          <li
            key={inv.invoiceId}
            className="rounded-lg border border-gray-100 px-3 py-2.5 text-xs"
          >
            <div className="flex items-center justify-between">
              <span className="text-gray-600">
                {formatDate(inv.periodStart, DATE_FORMATS.KO_DOT)} ~{" "}
                {formatDate(inv.periodEnd, DATE_FORMATS.KO_DOT)}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 font-medium ${STATUS_COLOR[inv.status] ?? "text-gray-500 bg-gray-100"}`}
              >
                {t(`invoices.status.${inv.status}`)}
              </span>
            </div>
            <div className="mt-1.5 flex items-center justify-between">
              <span className="font-medium text-gray-800">
                {t("billing.amountWon", { amount: inv.amountDue.toLocaleString() })}
              </span>
              {inv.isRetryable && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  disabled={retryingId === inv.invoiceId}
                  onClick={() => handleRetry(inv.invoiceId)}
                >
                  {retryingId === inv.invoiceId ? t("invoices.retrying") : t("invoices.retry")}
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
