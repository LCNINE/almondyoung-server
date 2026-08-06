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

/** 출금이 실제로 실패한 상태들. 이때는 '왜' 와 '무엇을 하면 되는지' 가 함께 보여야 한다. */
const FAILED_STATUSES: MyInvoiceStatus[] = [
  "PAST_DUE",
  "UNCOLLECTIBLE",
  "MANDATE_REJECTED",
]

/**
 * 실패가 아닌 상태에도 지금 무슨 일이 일어나는 중인지 한 줄로 알려준다.
 * 상태 배지("계좌 확인 중")만으로는 고객이 기다리면 되는 건지 뭘 해야 하는 건지 알 수 없다.
 */
const PROGRESS_NOTE_KEY = {
  OPEN: "invoices.noteOpen",
  MANDATE_PENDING: "invoices.noteMandatePending",
  ATTEMPTING: "invoices.noteAttempting",
  VOID: "invoices.noteVoid",
} as const satisfies Partial<Record<MyInvoiceStatus, string>>

type ProgressStatus = keyof typeof PROGRESS_NOTE_KEY

const hasProgressNote = (status: MyInvoiceStatus): status is ProgressStatus =>
  status in PROGRESS_NOTE_KEY

/**
 * 고객 본인 멤버십 인보이스(정기결제 청구) 목록. 구독 계약이 없으면(빈 배열) 섹션 자체를 숨긴다.
 * 미납(PAST_DUE)만 즉시 재시도 CTA 를 노출 — 심사대기/진행중은 재시도해도 소용없으므로 표시만.
 *
 * 상태 배지만으로는 고객이 움직일 수 없다 — '결제 실패' 를 보고도 잔액을 채우면 되는 건지 계좌를
 * 바꿔야 하는 건지 알 수 없어 그대로 문의가 된다. 실패 사유와 남은 시도 횟수를 함께 적는다.
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
            {FAILED_STATUSES.includes(inv.status) && (
              <div className="mt-1.5 rounded-md bg-red-50 px-2 py-1.5 text-red-900">
                <p className="leading-4">
                  {inv.lastErrorMessage
                    ? t("invoices.failureReason", { reason: inv.lastErrorMessage })
                    : t("invoices.failureReasonUnknown")}
                </p>
                {/* 무엇을 하면 되는지까지 적는다. 사유만 알려주면 그대로 문의가 된다. */}
                <p className="mt-0.5 leading-4">
                  {inv.status === "MANDATE_REJECTED"
                    ? t("invoices.failureActionMandate")
                    : inv.status === "UNCOLLECTIBLE"
                      ? t("invoices.failureActionUncollectible")
                      : t("invoices.failureActionPastDue")}
                </p>
                {/* 몇 번째 실패인지·몇 번 더 실패하면 끊기는지가 없으면 예고 없이 종료된 것으로 읽힌다. */}
                {inv.status === "PAST_DUE" && (
                  <p className="mt-0.5 leading-4">
                    {t("invoices.attempts", {
                      attempt: inv.attemptCount,
                      max: inv.maxAttempts,
                    })}
                    {inv.attemptCount < inv.maxAttempts
                      ? ` · ${t("invoices.remainingAttempts", {
                          remaining: inv.maxAttempts - inv.attemptCount,
                        })}`
                      : ""}
                    {inv.nextAttemptAt
                      ? ` · ${t("invoices.nextAttempt", {
                          date: formatDate(inv.nextAttemptAt, DATE_FORMATS.KO_DOT),
                        })}`
                      : ""}
                  </p>
                )}
              </div>
            )}
            {hasProgressNote(inv.status) && (
              <p className="mt-1.5 leading-4 text-gray-500">
                {t(PROGRESS_NOTE_KEY[inv.status])}
              </p>
            )}
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
