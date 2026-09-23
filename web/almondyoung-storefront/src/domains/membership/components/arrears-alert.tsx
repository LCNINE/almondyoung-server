import { getTranslations } from "next-intl/server"
import LocalizedClientLink from "@/components/shared/localized-client-link"

/**
 * 미수 요약 알림 — 마이페이지 메인·홈처럼 «멤버십 화면이 아닌 곳»에 놓는다.
 *
 * 금액과 한 줄 이유, 상세로 가는 링크까지만 둔다. 설명은 멤버십 페이지의 미수 섹션 한 곳에만 있다.
 *
 * 조회는 «부르는 화면이 한 번만» 한다 — 이 컴포넌트가 스스로 가져오면 한 화면에 모바일·데스크탑
 * 두 벌이 걸린 곳에서 같은 조회가 두 번 나간다(미수가 없는 대부분의 고객에게도).
 * 미수가 없으면 아무것도 그리지 않으므로 그 화면들은 기준선 그대로다.
 */
export default async function ArrearsAlert({
  total,
  className,
}: {
  total: number
  className?: string
}) {
  if (total <= 0) return null
  const t = await getTranslations("mypage.membership.arrears")

  return (
    <LocalizedClientLink
      href="/mypage/membership"
      data-testid="arrears-alert"
      className={`border-border block rounded-lg border bg-white px-4 py-3 ${className ?? ""}`}
    >
      <p className="text-foreground text-sm font-bold">
        {t("alertTitle", { amount: total.toLocaleString() })}
      </p>
      <p className="text-muted-foreground mt-1 text-xs leading-4">
        {t("alertBody")}
      </p>
    </LocalizedClientLink>
  )
}
