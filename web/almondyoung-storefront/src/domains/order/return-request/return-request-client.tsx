"use client"

import { CustomButton } from "@/components/shared/custom-buttons"
import { CustomCheckbox } from "@/components/shared/checkbox"
import LocalizedClientLink from "@/components/shared/localized-client-link"
import { NumberStepper } from "@/components/shared/number-stepper"
import { PageTitle } from "@/components/shared/page-title"
import { requestReturn } from "@/lib/api/medusa/returns"
import type { ReturnRequestOutcome } from "@/lib/api/medusa/return-outcome"
import type { ReturnRequestInput } from "@/lib/types/ui/returns"
import { cn } from "@/lib/utils"
import { DATE_FORMATS, formatDate } from "@/lib/utils/format-date"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { useState, useTransition } from "react"
import { toast } from "sonner"
import { rejectMessageKey, reasonLabelKey } from "./return-reasons"
import {
  copyKey,
  feeNotice,
  initialSelection,
  nextSubmitState,
  reasonsFor,
  setLineQuantity,
  toggleLine,
  validateReturnForm,
  type ReturnFormLine,
  type ReturnFormMode,
  type SubmitState,
} from "./return-request-form"

interface ReturnRequestClientProps {
  orderId: string
  lines: ReturnFormLine[]
  preselectItemId?: string
  pickupAddress: string | null
  /** 반품 폼과 교환 폼은 한 컴포넌트다(N10) — 제목·사유 칩·택배비 줄·완료 문구·본문 kind 가 갈린다. */
  mode: ReturnFormMode
}

const newId = () => crypto.randomUUID()

export function ReturnRequestClient({ orderId, lines, preselectItemId, pickupAddress, mode }: ReturnRequestClientProps) {
  const t = useTranslations("mypage.order.returnRequest")
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [selection, setSelection] = useState(() => initialSelection(lines, preselectItemId))
  const [reason, setReason] = useState("")
  const [note, setNote] = useState("")
  const [submit, setSubmit] = useState<SubmitState>(() => ({ requestId: newId(), locked: null, conflict: false }))
  const [done, setDone] = useState(false)

  const detailsHref = `/mypage/order/details?orderId=${encodeURIComponent(orderId)}`
  const text = (key: string, values?: Record<string, string | number>) =>
    t(key as Parameters<typeof t>[0], values as never)
  const selectable = lines.some((l) => l.blocked === "none")
  const frozen = submit.locked !== null || submit.conflict
  const disabled = frozen || isPending
  const notice = feeNotice(reason, mode)
  const copy = (key: Parameters<typeof copyKey>[1]) => text(copyKey(mode, key))

  const backLink = (label: string, primary = false) => (
    <LocalizedClientLink href={detailsHref}>
      <CustomButton variant={primary ? "fill" : "outline"} color={primary ? "primary" : "secondary"} size="md">
        {label}
      </CustomButton>
    </LocalizedClientLink>
  )

  if (done) {
    return (
      <div className="bg-white px-4 py-8 md:min-h-screen md:px-6">
        <div className="flex flex-col items-center gap-6 py-10 text-center">
          <p className="text-base font-medium text-foreground">{copy("done")}</p>
          {backLink(t("viewOrder"), true)}
        </div>
      </div>
    )
  }

  if (!selectable) {
    return (
      <div className="bg-white px-4 py-8 md:min-h-screen md:px-6">
        <PageTitle>{copy("title")}</PageTitle>
        <p className="mt-6 font-medium text-foreground">{copy("empty")}</p>
        <div className="mt-6">{backLink(t("backToOrder"))}</div>
      </div>
    )
  }

  const handleOutcome = (sent: ReturnRequestInput, outcome: ReturnRequestOutcome) => {
    if (outcome.kind === "requested") {
      setDone(true)
      return
    }
    setSubmit((prev) => nextSubmitState(prev, sent, outcome, newId))
    if (outcome.kind === "rejected") {
      if (outcome.reason !== "request_id_conflict") {
        toast.error(text(rejectMessageKey(outcome.reason, mode)))
        // 반품 가능 수량이 바뀌었을 수 있다 — 서버 값으로 다시 그린다.
        router.refresh()
      }
    } else if (outcome.kind === "canceled_replay") {
      toast.error(t("canceledReplay"))
    } else if (outcome.kind === "unknown") {
      toast.error(t("unknownNotice"))
    } else {
      toast.error(t("retryTitle"))
    }
  }

  const handleSubmit = () => {
    let input = submit.locked
    if (!input) {
      const invalid = validateReturnForm(selection, reason)
      if (invalid) {
        toast.error(invalid === "select_item" ? copy("selectItem") : copy("selectReason"))
        return
      }
      input = {
        requestId: submit.requestId,
        items: Object.entries(selection).map(([itemId, quantity]) => ({ itemId, quantity })),
        reason,
        note: note.trim() || undefined,
        // 반품은 kind 를 싣지 않는다 — 본문(해시)이 PR 11 전과 같게.
        ...(mode === "exchange" ? { kind: "exchange" as const } : {}),
      }
    }
    const sent = input
    startTransition(async () => {
      let outcome: ReturnRequestOutcome
      try {
        outcome = await requestReturn(orderId, sent)
      } catch (error: unknown) {
        const err = error as Error & { digest?: string }
        if (err.digest === "UNAUTHORIZED" || err.message === "UNAUTHORIZED") throw error
        outcome = { kind: "unknown" }
      }
      handleOutcome(sent, outcome)
    })
  }

  return (
    <div className="bg-white px-4 py-4 md:min-h-screen md:px-6">
      <PageTitle>{copy("title")}</PageTitle>

      <fieldset disabled={disabled} className="m-0 mt-4 min-w-0 space-y-8 border-0 p-0">
        <section>
          <h2 className="mb-3 text-sm font-bold text-foreground">{copy("linesTitle")}</h2>
          <ul className="space-y-3">
            {lines.map((line) => {
              const open = line.blocked === "none"
              const qty = selection[line.itemId]
              const checked = qty !== undefined
              return (
                <li
                  key={line.itemId}
                  className={cn("rounded-xl border border-border p-4", checked && "border-foreground", !open && "opacity-50")}
                >
                  <div className="flex items-start gap-3">
                    <CustomCheckbox
                      className="mt-1"
                      checked={checked}
                      disabled={!open || disabled}
                      onCheckedChange={() => setSelection((s) => toggleLine(s, line))}
                      aria-label={line.title}
                    />
                    {line.thumbnail ? (
                      <img
                        className="h-16 w-16 shrink-0 rounded-lg border border-border object-cover"
                        src={line.thumbnail}
                        alt={line.title}
                      />
                    ) : (
                      <div className="h-16 w-16 shrink-0 rounded-lg border border-border bg-muted" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground">{line.title}</p>
                      {line.variantTitle && line.variantTitle !== "Default" && (
                        <p className="mt-1 text-xs text-muted-foreground">{line.variantTitle}</p>
                      )}
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t("orderedQuantity", { count: line.orderedQuantity })}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {line.blocked === "nothing_left" && copy("nothingLeft")}
                        {line.blocked === "not_exchangeable" && t("exchange.notExchangeable")}
                        {line.blocked === "window_closed" &&
                          t("windowClosed", { date: formatDate(line.windowEndsAt, DATE_FORMATS.KO_DOT) })}
                        {open &&
                          line.windowEndsAt !== null &&
                          t("deadline", { date: formatDate(line.windowEndsAt, DATE_FORMATS.KO_DOT) })}
                      </p>
                    </div>
                  </div>
                  {checked && (
                    <div className="mt-3 flex justify-end">
                      <NumberStepper
                        yearsOperating={qty}
                        increment={() => setSelection((s) => setLineQuantity(s, line, qty + 1))}
                        decrement={() => setSelection((s) => setLineQuantity(s, line, qty - 1))}
                        setValue={(v) => setSelection((s) => setLineQuantity(s, line, v))}
                      />
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </section>

        <section>
          <h2 className="mb-3 text-sm font-bold text-foreground">{copy("reasonTitle")}</h2>
          <div className="flex flex-wrap gap-2">
            {reasonsFor(mode).map((r) => (
              <button
                key={r.value}
                type="button"
                disabled={disabled}
                aria-pressed={reason === r.value}
                onClick={() => setReason(r.value)}
                className={cn(
                  "h-8 rounded-full px-3 text-[13px] font-medium disabled:opacity-50",
                  reason === r.value ? "bg-foreground text-white" : "bg-secondary text-foreground"
                )}
              >
                {text(reasonLabelKey(r.value))}
              </button>
            ))}
          </div>
          {notice && (
            <p className="mt-3 text-xs text-muted-foreground">
              {mode === "exchange" ? t("exchange.fee") : notice === "customer" ? t("feeCustomer") : t("feeSeller")}
            </p>
          )}
          <label className="mb-1 mt-4 block text-xs text-muted-foreground" htmlFor="return-note">
            {t("noteLabel")}
          </label>
          <textarea
            id="return-note"
            maxLength={500}
            rows={3}
            value={note}
            disabled={disabled}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("notePlaceholder")}
            className="w-full rounded-lg border border-border p-3 text-sm placeholder:text-muted-foreground focus:border-foreground focus:outline-none disabled:opacity-50"
          />
        </section>

        <section>
          <h2 className="mb-2 text-sm font-bold text-foreground">{t("pickupTitle")}</h2>
          {pickupAddress && <p className="text-sm text-foreground">{pickupAddress}</p>}
          <p className="mt-1 text-xs text-muted-foreground">{t("pickupHint")}</p>
        </section>
      </fieldset>

      {submit.conflict ? (
        <div className="mt-8 space-y-4 pb-6">
          <p className="text-sm font-medium text-foreground">{t("conflict")}</p>
          {backLink(t("viewOrder"))}
        </div>
      ) : (
        <div className="mt-8 pb-6">
          {submit.locked && <p className="mb-3 text-xs text-muted-foreground">{t("unknownNotice")}</p>}
          <CustomButton
            type="button"
            variant="fill"
            color="primary"
            size="lg"
            fullWidth
            isLoading={isPending}
            disabled={isPending}
            onClick={handleSubmit}
          >
            {isPending ? t("submitting") : submit.locked ? t("resubmit") : copy("submit")}
          </CustomButton>
        </div>
      )}
    </div>
  )
}
