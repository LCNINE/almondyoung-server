"use client"

import { useTranslations } from "next-intl"
import { AddressRow } from "../address-selector-modal/components"

interface AddressDisplayProps {
  phone: string
  postalCode: string
  address1: string
  address2: string
  fullAddress: string
  isDefault?: boolean
}

/**
 * 카드 본문의 배송지 요약하는 컴포넌트
 */
export function AddressDisplay({
  phone,
  postalCode,
  address1,
  address2,
  fullAddress,
  isDefault,
}: AddressDisplayProps) {
  const t = useTranslations("checkout.shipping")
  return (
    <div className="space-y-2">
      {isDefault && (
        <span className="inline-block rounded-full border border-gray-300 px-2 py-[3px] text-[12px] text-gray-600">
          {t("defaultBadge")}
        </span>
      )}
      <dl className="space-y-1 text-[14px] leading-relaxed lg:text-[15px]">
        <AddressRow label={t("postalCode")} value={postalCode} />
        <AddressRow label={t("address1")} value={address1 || fullAddress} />
        <AddressRow label={t("address2")} value={address2} />
      </dl>
      <p className="text-[14px] text-gray-600 lg:text-[15px]">
        {t("contact")} : {phone || "-"}
      </p>
    </div>
  )
}
