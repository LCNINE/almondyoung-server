"use client"

import { useTranslations } from "next-intl"
import type { IssuedCashReceiptDto } from "@/lib/types/dto/wallet"

// wallet 이 저장하는 현금영수증 type(한글 리터럴) → i18n 키 매핑
const TYPE_KEY: Record<string, string> = {
  소득공제: "typeIncome",
  지출증빙: "typeExpense",
}

/**
 * 주문상세의 결제 정보 섹션에 붙는 현금영수증 정보 블록.
 * 발급완료(ISSUED)된 영수증이 없으면 아무것도 렌더하지 않는다 (기존 화면과 동일).
 */
export const CashReceiptInfo = ({
  cashReceipts,
}: {
  cashReceipts: IssuedCashReceiptDto[]
}) => {
  const t = useTranslations("mypage.order.cashReceipt")
  const issued = cashReceipts.filter((r) => r.status === "ISSUED")
  if (issued.length === 0) return null

  return (
    <div className="mt-3 space-y-2 rounded-md bg-gray-50 p-3">
      <p className="text-sm font-medium text-gray-700">{t("sectionTitle")}</p>
      {issued.map((r) => (
        <div key={r.id} className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">{t("typeLabel")}:</span>
            <span className="text-xs text-gray-800">
              {t(TYPE_KEY[r.type] ?? "typeIncome")}
            </span>
          </div>
          {r.issueNumber && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">{t("issueNumber")}:</span>
              <span className="text-xs text-gray-800">{r.issueNumber}</span>
            </div>
          )}
          {r.receiptUrl && (
            <a
              href={r.receiptUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block text-xs font-medium text-blue-600 underline underline-offset-2"
            >
              {t("viewReceipt")}
            </a>
          )}
        </div>
      ))}
    </div>
  )
}
