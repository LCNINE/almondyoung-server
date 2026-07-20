"use client"

import { useTranslations } from "next-intl"
import LocalizedClientLink from "@/components/shared/localized-client-link"
import MembershipBenefitsGuide from "./membership-benefits-guide"

const LEGACY_URL =
  process.env.NEXT_PUBLIC_LEGACY_MEMBERSHIP_HISTORY_URL ??
  "https://lcnine.cafe24.com/myshop/mileage/historyList.html"

/** 카드/버튼 없이 텍스트 링크 한 줄 */
const ROW =
  "text-muted-foreground hover:text-foreground w-fit text-sm underline underline-offset-4 transition-colors"

interface Props {
  hasHistory: boolean
  hasCafe24Link: boolean
}

export default function NonSubscriberSection({
  hasHistory,
  hasCafe24Link,
}: Props) {
  const t = useTranslations("mypage.membership")

  return (
    <div className="flex flex-col gap-3">
      {(hasHistory || hasCafe24Link) && (
        <div className="flex flex-col items-start gap-2 px-1 py-1">
          {hasHistory && (
            <LocalizedClientLink
              href="/mypage/membership/history"
              className={ROW}
            >
              {t("history.subscriptionHistory")}
            </LocalizedClientLink>
          )}
          {/* 기존 아몬드영 멤버십 내역 (Cafe24 연동 고객 전용) */}
          {hasCafe24Link && (
            <a
              href={LEGACY_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={ROW}
            >
              {t("history.legacyHistory")}
            </a>
          )}
        </div>
      )}

      {/* 멤버십 가입 유도 + 혜택 안내 */}
      <MembershipBenefitsGuide showSubscribeCta />
    </div>
  )
}
