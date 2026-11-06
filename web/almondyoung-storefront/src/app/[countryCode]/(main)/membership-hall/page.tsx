import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { MembershipHallTemplate } from "@/domains/membership-hall/templates/membership-hall-template"
import {
  parseHallState,
  type HallSearchParams,
} from "@/domains/membership-hall/utils/hall-params"

export async function generateMetadata({
  params,
}: {
  params: Promise<{ countryCode: string }>
}): Promise<Metadata> {
  const [{ countryCode }, t] = await Promise.all([
    params,
    getTranslations("membershipHall"),
  ])

  // 탭·분야·정렬 조합은 같은 상품을 다시 늘어놓은 것이라 기본 주소 하나로 모은다
  return {
    title: t("title"),
    description: t("description"),
    alternates: { canonical: `/${countryCode}/membership-hall` },
  }
}

export default async function MembershipHallPage({
  params,
  searchParams,
}: {
  params: Promise<{ countryCode: string }>
  searchParams: Promise<HallSearchParams>
}) {
  const [{ countryCode }, query] = await Promise.all([params, searchParams])

  return (
    <MembershipHallTemplate
      countryCode={countryCode}
      state={parseHallState(query)}
    />
  )
}
