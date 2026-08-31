import { SiteBreadcrumb } from "@/components/shared/site-breadcrumb"
import { TimeSaleWrapper } from "@/domains/home/template/time-sale"
import { listActiveTimeSales } from "@/lib/api/medusa/time-sale"
import { NOINDEX } from "@lib/seo"
import { getTranslations } from "next-intl/server"
import type { Metadata } from "next"

// 내용이 며칠마다 통째로 바뀌고 세일 사이엔 비어 있다. 크롤 시점의 세일가가 색인되면
// 세일이 끝난 뒤에도 검색결과에 남는데, revalidateTag 로는 구글 색인을 못 지운다.
export const metadata: Metadata = { robots: NOINDEX }

export default async function TimeSalePage({
  params,
}: {
  params: Promise<{ countryCode: string }>
}) {
  const { countryCode } = await params
  const [sales, t] = await Promise.all([
    listActiveTimeSales(),
    getTranslations("home.timeSale"),
  ])

  return (
    <div className="container mx-auto max-w-[1360px] px-4 py-6 md:px-[40px]">
      <SiteBreadcrumb className="mb-4" items={[{ label: "타임세일" }]} />

      {/* 세일이 없어도 404 로 보내지 않는다 — 이 링크는 홈·카트·상품상세에 박혀 있어서
          세일 사이에 죽은 링크가 된다. */}
      {sales.length > 0 ? (
        <TimeSaleWrapper countryCode={countryCode} />
      ) : (
        <div className="py-24 text-center">
          <p className="text-lg font-semibold">{t("noSaleTitle")}</p>
          <p className="mt-2 text-sm text-muted-foreground">{t("noSaleDescription")}</p>
        </div>
      )}
    </div>
  )
}
