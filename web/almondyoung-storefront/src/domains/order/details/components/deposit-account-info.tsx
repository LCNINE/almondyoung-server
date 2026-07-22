"use client"

import { useTranslations } from "next-intl"
import { toast } from "sonner"
import type { BankTransferDepositAccount } from "@/lib/api/wallet"

export function DepositAccountInfo({
  account,
}: {
  account: BankTransferDepositAccount
}) {
  const t = useTranslations("mypage.order.depositAccount")

  const copy = async () => {
    if (!account.accountNumber) return
    try {
      await navigator.clipboard.writeText(account.accountNumber)
      toast.success(t("copied"))
    } catch {
      // clipboard 미지원 환경은 조용히 무시
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm">
      <p className="font-semibold">{t("title")}</p>
      <p className="rounded-md bg-amber-100 px-3 py-2 text-xs font-medium text-amber-800">
        {t("confirmDelay")}
      </p>
      <dl className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <dt className="text-muted-foreground">{t("bank")}</dt>
          <dd className="font-medium">{account.bankName ?? "-"}</dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-muted-foreground">{t("accountNumber")}</dt>
          <dd className="flex items-center gap-2">
            <span className="font-mono font-semibold">{account.accountNumber ?? "-"}</span>
            {account.accountNumber && (
              <button
                type="button"
                onClick={copy}
                className="cursor-pointer rounded border border-neutral-300 bg-white px-2 py-0.5 text-xs"
              >
                {t("copy")}
              </button>
            )}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-muted-foreground">{t("holder")}</dt>
          <dd className="font-medium">{account.accountHolder ?? "-"}</dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-muted-foreground">{t("amount")}</dt>
          <dd className="font-semibold">{account.amount.toLocaleString("ko-KR")}원</dd>
        </div>
        {account.dueDate && (
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted-foreground">{t("dueDate")}</dt>
            <dd>{new Date(account.dueDate).toLocaleString("ko-KR")}</dd>
          </div>
        )}
      </dl>
      <p className="text-xs text-amber-700">{t("notice")}</p>
    </div>
  )
}
