import { useTranslations } from "next-intl"
import { DATE_FORMATS, formatDate } from "@/lib/utils/format-date"
import type { RefundStatusDto } from "@lib/types/dto/membership"

/**
 * 환불 진행 상황.
 *
 * 즉시해지하면 마이페이지가 비가입자 화면으로 바뀐다. 해지 직후 토스트를 놓친 고객은 얼마가 언제
 * 어디로 들어오는지 다시 볼 방법이 없어 "환불이 안 됐다" 는 문의로 이어진다. 가입 여부와 무관하게
 * 이 카드를 띄운다.
 */
export default function RefundStatusCard({
  refundStatus,
}: {
  refundStatus: RefundStatusDto
}) {
  const t = useTranslations("mypage.membership.refundStatus")
  const amount = refundStatus.amount.toLocaleString("ko-KR")
  const completed = refundStatus.status === "COMPLETED"

  return (
    <div
      data-testid="refund-status-card"
      className={`mb-3 w-full rounded-xl border px-4 py-3 ${
        completed ? "border-border bg-white" : "border-amber-200 bg-amber-50"
      }`}
    >
      <p
        className={`text-sm font-bold ${completed ? "text-foreground" : "text-amber-900"}`}
      >
        {completed ? t("completedTitle") : t("pendingTitle")}
      </p>
      <p
        className={`mt-1 text-xs leading-5 ${completed ? "text-muted-foreground" : "text-amber-900"}`}
      >
        {completed
          ? t("completedBody", {
              amount,
              date: formatDate(refundStatus.completedAt, DATE_FORMATS.KO_LONG),
            })
          : t("pendingBody", {
              amount,
              days: refundStatus.refundProcessingBusinessDays,
            })}
      </p>
      {/* 어디로 들어오는지가 없으면 고객은 자기 계좌를 어디서 확인할지 모른다. */}
      {!completed && refundStatus.maskedAccount && (
        <p className="mt-1 text-xs leading-5 text-amber-900">
          {t("account", {
            bank: refundStatus.maskedAccount.bank,
            account: refundStatus.maskedAccount.accountNumber,
            holder: refundStatus.maskedAccount.holderName,
          })}
        </p>
      )}
      {refundStatus.status === "FAILED" && (
        <p className="mt-1 text-xs leading-5 text-amber-900">{t("failedNote")}</p>
      )}
    </div>
  )
}
