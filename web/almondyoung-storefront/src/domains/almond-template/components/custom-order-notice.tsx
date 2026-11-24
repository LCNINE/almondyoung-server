"use client"

import { Check } from "lucide-react"
import { useTranslations } from "next-intl"
import { cn } from "@/lib/utils"

interface CustomOrderNoticeProps {
  id?: string
  className?: string
  withAgreement?: boolean
  agreed?: boolean
  onAgreeChange?: (agreed: boolean) => void
  // 내 파일로 주문한 인쇄 상품이 있으면 파일 문제로 생긴 불량은 재제작·환불되지 않는다는 것까지 동의받는다
  withCustomerFile?: boolean
}

interface MetadataCarrier {
  metadata?: Record<string, unknown> | null
}

// 아몬드템플릿 시안이나 고객이 올린 인쇄 파일이 붙은 줄 = 주문제작 인쇄 줄
export function cartHasAlmondDesign(items: readonly MetadataCarrier[]) {
  return items.some(
    (item) => !!item.metadata?.almond_design_id || !!item.metadata?.print_file_id
  )
}

export function cartHasCustomerPrintFile(items: readonly MetadataCarrier[]) {
  return items.some((item) => !!item.metadata?.print_file_id)
}

export function isCustomOrderPaymentBlocked(
  items: readonly MetadataCarrier[],
  agreed: boolean
) {
  return cartHasAlmondDesign(items) && !agreed
}

export const CUSTOM_ORDER_NOTICE_PAGE_ID = "custom-order-notice"

const STEPS = [1, 2, 3] as const

export function CustomOrderNotice({
  id,
  className,
  withAgreement = false,
  agreed = false,
  onAgreeChange,
  withCustomerFile = false,
}: CustomOrderNoticeProps) {
  const t = useTranslations(
    withAgreement
      ? "checkout.customOrderNotice"
      : "productDetail.customOrderNotice"
  )

  return (
    <div
      id={id}
      className={cn(
        "shrink-0 overflow-hidden rounded-2xl border bg-white transition-colors",
        withAgreement && agreed ? "border-foreground" : "border-border",
        className
      )}
    >
      <div className="p-5">
        <p className="text-[17px] leading-7 font-bold text-foreground">
          {t("headline")}
          <br />
          <span className="text-muted-foreground">{t("headlineSub")}</span>
        </p>

        <ol className="mt-5 flex flex-col">
          {STEPS.map((step) => {
            const last = step === STEPS.length

            return (
              <li key={step} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <span
                    className={cn(
                      "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                      last
                        ? "border-2 border-border text-muted-foreground"
                        : "bg-foreground text-white"
                    )}
                  >
                    {step}
                  </span>
                  {!last && <span className="w-0.5 flex-1 bg-border" />}
                </div>
                <div className={cn(!last && "pb-5")}>
                  <p className="text-[15px] font-bold text-foreground">
                    {t(`step${step}Title`)}
                  </p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {t(`step${step}Body`)}
                  </p>
                </div>
              </li>
            )
          })}
        </ol>

        {withAgreement && withCustomerFile && (
          <div className="mt-4 rounded-lg border border-border px-3 py-2.5">
            <p className="text-sm font-bold text-foreground">{t("fileStepTitle")}</p>
            <p className="mt-0.5 text-[13px] text-muted-foreground">{t("fileStepBody")}</p>
          </div>
        )}

        <p className="mt-4 rounded-lg bg-muted px-3 py-2.5 text-[13px] text-muted-foreground">
          {t("otherItems")}
        </p>
      </div>

      {withAgreement && (
        <label
          className={cn(
            "flex cursor-pointer items-start gap-2.5 border-t border-border px-5 py-4 text-sm leading-5 font-bold text-foreground",
            agreed && "bg-muted"
          )}
        >
          <input
            type="checkbox"
            className="peer sr-only"
            checked={agreed}
            onChange={(e) => onAgreeChange?.(e.target.checked)}
          />
          <span
            className={cn(
              "flex size-6 shrink-0 items-center justify-center rounded-full peer-focus-visible:ring-2 peer-focus-visible:ring-ring",
              agreed ? "bg-foreground text-white" : "border-2 border-border text-transparent"
            )}
          >
            <Check className="size-3.5" strokeWidth={3} />
          </span>
          <span className="pt-0.5">{t(withCustomerFile ? "agreeWithFile" : "agree")}</span>
        </label>
      )}
    </div>
  )
}

// 하단 고정 영역에 카드를 통째로 두면 옵션·선택 목록을 가린다. 한 줄로 알리고 누르면 카드로 데려간다
export function CustomOrderNoticeLine({ targetId }: { targetId: string }) {
  const t = useTranslations("productDetail.customOrderNotice")

  return (
    <button
      type="button"
      onClick={() =>
        document
          .getElementById(targetId)
          ?.scrollIntoView({ behavior: "smooth", block: "center" })
      }
      className="flex w-full items-center justify-between gap-2 rounded-lg bg-muted px-3 py-2.5 text-left text-[13px]"
    >
      <span className="font-bold text-foreground">{t("short")}</span>
      <span className="shrink-0 text-muted-foreground">{t("more")}</span>
    </button>
  )
}
