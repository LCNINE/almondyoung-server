import { useTranslations } from "next-intl"
import type { TerminationNoticeDto } from "@lib/types/dto/membership"

/**
 * 멤버십이 왜 끝났는지.
 *
 * 계좌 심사 거절·미수로 끊긴 고객에게 화면에 `가입하기` 만 남으면 **왜 끊겼는지 알 방법이 없다.**
 * 이유와 함께 다음에 무엇을 하면 되는지까지 적는다 — 이유만 알려주면 그대로 문의가 된다.
 */
export default function TerminationNoticeCard({
  notice,
}: {
  notice: TerminationNoticeDto
}) {
  const t = useTranslations("mypage.membership.termination")

  return (
    <div
      data-testid="termination-notice-card"
      className="mb-3 w-full rounded-xl border border-orange-200 bg-orange-50 px-4 py-3"
    >
      <p className="text-sm font-bold text-orange-900">{t("title")}</p>
      <p className="mt-1 text-xs leading-5 text-orange-900">{notice.notice}</p>
      {notice.reasonLabel && (
        <p className="mt-1 text-xs leading-4 text-orange-800">
          {t("reason", { reason: notice.reasonLabel })}
        </p>
      )}
    </div>
  )
}
