"use client"

import { Checkbox } from "@/checkout-ui/components/ui/checkbox"
import { Label } from "@/checkout-ui/components/ui/label"
import { useTranslations } from "next-intl"
import Link from "next/link"
import { useParams } from "next/navigation"

export interface OrderConsentState {
  purchaseTerms: boolean
  personalInfo: boolean
}

interface OrderConsentSectionProps {
  value: OrderConsentState
  onChange: (next: OrderConsentState) => void
  hasOverseasItem: boolean
}

/**
 * 청약 전 동의·고지 섹션.
 * 전자상거래법 §8③(구매조건 확인), §13②(거래조건·청약철회 고지),
 * 개인정보보호법 §22(동의 항목 분리)를 한 화면에서 충족한다.
 */
export function OrderConsentSection({
  value,
  onChange,
  hasOverseasItem,
}: OrderConsentSectionProps) {
  const t = useTranslations("checkout.consent")
  const params = useParams()
  const countryCode = (params.countryCode as string) ?? "kr"
  const allChecked = value.purchaseTerms && value.personalInfo

  const linkClass =
    "shrink-0 text-xs font-semibold whitespace-nowrap text-[#ff6600] underline underline-offset-2"

  return (
    <section aria-labelledby="order-consent-heading" className="mb-8">
      <h2
        id="order-consent-heading"
        className="mb-3 text-base font-bold text-gray-900 lg:text-xl"
      >
        {t("title")}
      </h2>
      <div className="rounded-md border border-gray-200 bg-white px-[14px] py-[18px] lg:rounded-[10px] lg:px-10 lg:py-8">
        <div className="flex items-center gap-2.5 border-b border-gray-200 pb-3">
          <Checkbox
            id="consent-all"
            checked={allChecked}
            onCheckedChange={(checked) =>
              onChange({
                purchaseTerms: checked === true,
                personalInfo: checked === true,
              })
            }
          />
          <Label
            htmlFor="consent-all"
            className="cursor-pointer text-sm font-bold text-gray-900 lg:text-[15px]"
          >
            {t("allAgree")}
          </Label>
        </div>

        <div className="mt-3 space-y-3">
          <div className="flex items-center gap-2.5">
            <Checkbox
              id="consent-purchase-terms"
              checked={value.purchaseTerms}
              onCheckedChange={(checked) =>
                onChange({ ...value, purchaseTerms: checked === true })
              }
            />
            <Label
              htmlFor="consent-purchase-terms"
              className="flex-1 cursor-pointer text-[13px] leading-snug font-normal text-gray-700 lg:text-sm"
            >
              {t("purchaseTerms")}
            </Label>
            <Link
              href={`/${countryCode}/terms`}
              target="_blank"
              rel="noopener noreferrer"
              className={linkClass}
            >
              {t("viewFull")}
            </Link>
          </div>

          <div className="flex items-center gap-2.5">
            <Checkbox
              id="consent-personal-info"
              checked={value.personalInfo}
              onCheckedChange={(checked) =>
                onChange({ ...value, personalInfo: checked === true })
              }
            />
            <Label
              htmlFor="consent-personal-info"
              className="flex-1 cursor-pointer text-[13px] leading-snug font-normal text-gray-700 lg:text-sm"
            >
              {t("personalInfo")}
            </Label>
            <Link
              href={`/${countryCode}/privacy`}
              target="_blank"
              rel="noopener noreferrer"
              className={linkClass}
            >
              {t("viewFull")}
            </Link>
          </div>

          <table className="w-full table-fixed border-collapse text-[11px] text-gray-500 lg:text-xs">
            <tbody>
              {(
                [
                  ["personalInfoTable.purposeLabel", "personalInfoTable.purpose"],
                  ["personalInfoTable.itemsLabel", "personalInfoTable.items"],
                  [
                    "personalInfoTable.retentionLabel",
                    "personalInfoTable.retention",
                  ],
                ] as const
              ).map(([label, body]) => (
                <tr key={label} className="border-t border-gray-100">
                  <th
                    scope="row"
                    className="w-[68px] py-1.5 pr-2 text-left font-medium text-gray-600 align-top lg:w-[92px]"
                  >
                    {t(label)}
                  </th>
                  <td className="py-1.5 leading-relaxed">{t(body)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[11px] leading-relaxed text-gray-500 lg:text-xs">
            {t("personalInfoRefusal")}
          </p>
          {hasOverseasItem && (
            <p className="text-[11px] leading-relaxed text-gray-500 lg:text-xs">
              {t("customsNotice")}
            </p>
          )}
        </div>

        <div className="mt-4 rounded-md bg-gray-50 px-3 py-3">
          <p className="mb-1.5 text-[13px] font-bold text-gray-900 lg:text-sm">
            {t("withdrawal.title")}
          </p>
          <ul className="list-disc space-y-1 pl-4 text-[11px] leading-relaxed text-gray-600 lg:text-xs">
            <li>{t("withdrawal.period")}</li>
            <li>{t("withdrawal.method")}</li>
            <li>{t("withdrawal.shippingFee")}</li>
            <li>{t("withdrawal.restriction")}</li>
          </ul>
          <Link
            href={`/${countryCode}/guide`}
            target="_blank"
            rel="noopener noreferrer"
            className={`${linkClass} mt-2 inline-block`}
          >
            {t("withdrawal.viewGuide")}
          </Link>
        </div>
      </div>
    </section>
  )
}
