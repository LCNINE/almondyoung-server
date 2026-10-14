"use client"

import { useTranslations } from "next-intl"

interface CustomOrderNoticeProps {
  withAgreement?: boolean
  agreed?: boolean
  onAgreeChange?: (agreed: boolean) => void
}

interface MetadataCarrier {
  metadata?: Record<string, unknown> | null
}

export function cartHasAlmondDesign(items: readonly MetadataCarrier[]) {
  return items.some((item) => !!item.metadata?.almond_design_id)
}

export function isCustomOrderPaymentBlocked(
  items: readonly MetadataCarrier[],
  agreed: boolean
) {
  return cartHasAlmondDesign(items) && !agreed
}

export function CustomOrderNotice({
  withAgreement = false,
  agreed = false,
  onAgreeChange,
}: CustomOrderNoticeProps) {
  const t = useTranslations(
    withAgreement
      ? "checkout.customOrderNotice"
      : "productDetail.customOrderNotice"
  )

  return (
    <div className="rounded-lg border border-gray-300 bg-gray-50 p-4">
      <p className="text-sm font-bold text-gray-900">{t("title")}</p>
      <ul className="mt-2 space-y-1 text-sm leading-relaxed text-gray-700">
        <li>{t("body1")}</li>
        <li>
          {t.rich("body2", {
            strong: (chunks) => (
              <strong className="font-bold text-gray-900">{chunks}</strong>
            ),
          })}
        </li>
        <li>{t("body3")}</li>
        <li>{t("body4")}</li>
      </ul>
      {withAgreement && (
        <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm font-bold text-gray-900">
          <input
            type="checkbox"
            className="size-4 cursor-pointer"
            checked={agreed}
            onChange={(e) => onAgreeChange?.(e.target.checked)}
          />
          {t("agree")}
        </label>
      )}
    </div>
  )
}
