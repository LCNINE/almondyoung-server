import { listRegions } from "@/lib/api/medusa/regions"
import { notFound } from "next/navigation"

// 등록된 국가코드가 아니면 404. /llms.txt 같은 경로가 홈으로 렌더되는 걸 막는다.
export default async function CountryCodeLayout(props: {
  children: React.ReactNode
  params: Promise<{ countryCode: string }>
}) {
  const { countryCode } = await props.params

  // 조회 실패(null)는 통과 — Medusa 장애 때 전 페이지가 404 되면 안 된다.
  const regions = await listRegions().catch(() => null)
  const isKnown =
    regions === null ||
    regions.some((region) =>
      region.countries?.some((country) => country.iso_2 === countryCode)
    )

  if (!isKnown) {
    notFound()
  }

  return props.children
}
