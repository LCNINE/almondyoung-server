import { listPublicTopNotices } from "@/lib/api/pim/top-notices"
import type { TopNotice } from "@/lib/types/ui/top-notice"
import { getTranslations } from "next-intl/server"
import { TopNoticeRotator } from "./top-notice-rotator"

export async function TopNoticeBar() {
  const notices: TopNotice[] = await listPublicTopNotices().catch((error) => {
    // 띠는 부가 기능이다. 받지 못하면 띠 없이 페이지를 그린다
    console.error("[TopNoticeBar] Failed to load top notices:", error)
    return []
  })

  if (notices.length === 0) {
    return null
  }

  const t = await getTranslations("header.topNotice")

  return (
    <section
      aria-label={t("ariaLabel")}
      className="bg-header-border text-xs text-white md:text-[13px]"
    >
      <TopNoticeRotator notices={notices} moreLabel={t("more")} />
    </section>
  )
}
