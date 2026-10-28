"use client"

import { useMemo, useSyncExternalStore } from "react"
import { useTranslations } from "next-intl"
import { Rating } from "@/components/rating"
import { trackEvent } from "@/lib/analytics/gtag"
import {
  savePurchaseSatisfaction,
  type PurchaseSatisfaction,
} from "@/lib/api/medusa/purchase-satisfaction"
import {
  MEMO_MAX,
  REASON_CODES,
  createSatisfactionFlow,
  type SatisfactionState,
} from "./purchase-satisfaction-flow"

type ViewProps = {
  state: SatisfactionState
  canSubmit: boolean
  onSelectRating: (rating: number) => void
  onToggleReason: (code: string) => void
  onMemo: (memo: string) => void
  onSkip: () => void
  onSubmit: () => void
  onChangeRating: () => void
}

export function PurchaseSatisfactionView({
  state,
  canSubmit,
  onSelectRating,
  onToggleReason,
  onMemo,
  onSkip,
  onSubmit,
  onChangeRating,
}: ViewProps) {
  const t = useTranslations("checkout.success.review")
  const { step, rating, saving, failed, reasons, memo } = state
  const scoreKey = String(rating) as "1" | "2" | "3" | "4" | "5"

  return (
    <section className="w-full max-w-[816px] rounded-[10px] border-[0.5px] border-[#d9d9d9] bg-white">
      <div className="flex flex-col items-center gap-4 px-6 py-6 sm:gap-6 sm:py-10">
        {step === "thanks" ? (
          <>
            <h2 className="text-base font-bold text-black sm:text-lg">
              {t("thanksTitle")}
            </h2>
            <p className="text-sm text-[#4b5563]">
              {rating <= 3 ? t("thanksLow") : t("thanksHigh")}
            </p>
            <button
              type="button"
              onClick={onChangeRating}
              className="min-h-12 px-4 text-sm text-[#4b5563] underline"
            >
              {t("changeRating")}
            </button>
          </>
        ) : (
          <>
            <div className="flex flex-col items-center gap-1">
              <h2 className="text-base font-bold text-black sm:text-lg">
                {t("title")}
              </h2>
              <p className="text-sm text-[#4b5563]">{t("subtitle")}</p>
            </div>
            <Rating rating={rating} onChange={onSelectRating} size={48} />
            <p className="min-h-5 text-sm text-[#374151]" aria-live="polite">
              {saving
                ? t("saving")
                : failed && step === "rate"
                  ? t("saveFailed")
                  : rating > 0
                    ? t(`scores.${scoreKey}`)
                    : ""}
            </p>
          </>
        )}

        {step === "detail" && (
          <div className="flex w-full flex-col gap-4 border-t border-[#eeeeee] pt-6">
            <p className="text-base font-bold text-black">
              {t("reasonTitle")}{" "}
              <span className="text-sm font-normal text-[#6b7280]">
                ({t("reasonHint")})
              </span>
            </p>
            <div className="flex flex-wrap gap-2">
              {REASON_CODES.map((code) => {
                const selected = reasons.includes(code)
                return (
                  <button
                    key={code}
                    type="button"
                    data-reason={code}
                    aria-pressed={selected}
                    onClick={() => onToggleReason(code)}
                    className={`min-h-11 rounded-full border px-4 text-sm ${
                      selected
                        ? "border-[#374151] bg-[#374151] text-white"
                        : "border-[#d9d9d9] bg-white text-black"
                    }`}
                  >
                    {t(`reasons.${code}`)}
                  </button>
                )
              })}
            </div>
            <label className="flex flex-col gap-2 text-sm text-black">
              {t("memoLabel")}
              <textarea
                value={memo}
                maxLength={MEMO_MAX}
                placeholder={t("memoPlaceholder")}
                onChange={(e) => onMemo(e.target.value)}
                className="min-h-24 rounded-[5px] border border-[#d9d9d9] p-3 text-sm"
              />
              <span className="self-end text-xs text-[#6b7280]">
                {memo.length}/{MEMO_MAX}
              </span>
            </label>
            {failed && (
              <p className="text-sm text-[#b91c1c]" role="alert">
                {t("saveFailed")}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onSkip}
                className="min-h-12 rounded-[5px] px-5 text-sm text-[#374151]"
              >
                {t("skip")}
              </button>
              <button
                type="button"
                disabled={!canSubmit || saving}
                onClick={onSubmit}
                className="min-h-12 rounded-[5px] bg-[#374151] px-6 text-sm font-bold text-white disabled:bg-[#d1d5db]"
              >
                {t("submit")}
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

export function PurchaseSatisfactionCard({
  orderId,
  initial,
}: {
  orderId: string
  initial: PurchaseSatisfaction | null
}) {
  const flow = useMemo(
    () =>
      createSatisfactionFlow({
        orderId,
        initial,
        save: savePurchaseSatisfaction,
        track: trackEvent,
      }),
    [orderId, initial]
  )
  const state = useSyncExternalStore(
    flow.subscribe,
    flow.getState,
    flow.getState
  )

  return (
    <PurchaseSatisfactionView
      state={state}
      canSubmit={flow.canSubmit()}
      onSelectRating={(r) => void flow.selectRating(r)}
      onToggleReason={flow.toggleReason}
      onMemo={flow.setMemo}
      onSkip={flow.skip}
      onSubmit={() => void flow.submitDetail()}
      onChangeRating={flow.changeRating}
    />
  )
}
