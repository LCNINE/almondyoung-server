import { PackageX } from "lucide-react"
import { getTranslations } from "next-intl/server"
import { SiteBreadcrumb } from "@/components/shared/site-breadcrumb"
import { Pagination } from "@/domains/category/components/pagination"
import { HallGrid } from "../components/hall-grid"
import { HallHeader } from "../components/hall-header"
import { HallToolbar } from "../components/hall-toolbar"
import { loadHallProducts } from "../utils/load-hall-products"
import {
  MEMBERSHIP_HALL_PAGE_SIZE,
  fieldHandle,
  totalPages,
  visibleHallFields,
  type HallState,
} from "../utils/hall-params"

export async function MembershipHallTemplate({
  countryCode,
  state: requested,
}: {
  countryCode: string
  state: HallState
}) {
  const t = await getTranslations("membershipHall")

  const load = (state: HallState) =>
    loadHallProducts({
      countryCode,
      tab: state.tab,
      sort: state.sort,
      category: state.field ? fieldHandle(state.field) : undefined,
      limit: MEMBERSHIP_HALL_PAGE_SIZE,
      offset: (state.page - 1) * MEMBERSHIP_HALL_PAGE_SIZE,
    })

  let state = requested
  let data = await load(state)

  // 진행 중인 특가가 끝났거나, 고른 분야가 이 탭에 없으면 전체로 돌린다. 빈 화면은 고장으로 읽힌다.
  const saleGone = state.tab === "sale" && !data.hall.hasMembershipSale
  const fieldGone =
    state.field !== null &&
    !visibleHallFields(data.hall.categories).includes(state.field)

  if (saleGone || fieldGone) {
    state = {
      ...state,
      tab: saleGone ? "all" : state.tab,
      field: fieldGone ? null : state.field,
      page: 1,
    }
    data = await load(state)
  }

  const { hall, products, isMember, wishlistIds } = data
  const pages = totalPages(hall.total)

  return (
    <div className="container mx-auto max-w-[1280px] px-4 pt-5 pb-20 md:px-[32px]">
      <SiteBreadcrumb className="mb-4" items={[{ label: t("title") }]} />
      <HallHeader isMember={isMember} />
      <HallToolbar
        state={state}
        total={hall.total}
        hasMembershipSale={hall.hasMembershipSale}
        fields={visibleHallFields(hall.categories)}
      />

      {products.length > 0 ? (
        <HallGrid
          products={products}
          isMember={isMember}
          wishlistIds={wishlistIds}
          countryCode={countryCode}
        />
      ) : (
        <div className="flex min-h-[360px] flex-col items-center justify-center text-center">
          <PackageX className="mb-4 size-12 text-gray-300" strokeWidth={1.5} />
          <p className="text-[15px] font-medium">{t("emptyTitle")}</p>
          <p className="text-muted-foreground mt-1.5 text-[13px]">
            {t("emptyDescription")}
          </p>
        </div>
      )}

      {pages > 1 && <Pagination page={state.page} totalPages={pages} />}
    </div>
  )
}
