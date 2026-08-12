import { LayoutGrid, List } from "lucide-react"
import { getTranslations } from "next-intl/server"
import LocalizedClientLink from "@/components/shared/localized-client-link"
import {
  SHOP_LISTING_BUSINESS_TYPES,
  SHOP_LISTING_DEAL_TYPES,
  SHOP_LISTING_REGIONS,
  SHOP_TRADE_KEY_MONEY_BANDS,
} from "@/lib/types/ui/shop-listing"
import { cn } from "@/lib/utils"
import {
  buildListHref,
  hasActiveFilter,
  type ShopTradeListParams,
} from "../../build-list-href"
import { FilterSelect } from "../filter-select"
import { PerPageSelect } from "../per-page-select"

export async function ListToolbar({
  params,
  total,
}: {
  params: ShopTradeListParams
  total: number
}) {
  const t = await getTranslations("shopTrade")

  const hasFilter = hasActiveFilter(params)

  const viewButton = (active: boolean) =>
    cn(
      "flex h-9 w-9 items-center justify-center rounded-lg border transition-colors",
      active
        ? "border-primary text-primary"
        : "border-border text-muted-foreground hover:text-foreground"
    )

  return (
    <div className="mb-6 flex flex-col gap-3">
      <div className="scrollbar-hide -mx-3.5 flex gap-2 overflow-x-auto px-3.5 xl:mx-0 xl:px-0">
        <FilterSelect
          params={params}
          paramKey="region"
          value={params.region}
          allLabel={t("allRegions")}
          options={SHOP_LISTING_REGIONS.map((region) => ({
            value: region,
            label: t(`regions.${region}`),
          }))}
        />
        <FilterSelect
          params={params}
          paramKey="businessType"
          value={params.businessType}
          allLabel={t("allBusiness")}
          options={SHOP_LISTING_BUSINESS_TYPES.map((type) => ({
            value: type,
            label: t(`businessTypes.${type}`),
          }))}
        />
        <FilterSelect
          params={params}
          paramKey="dealType"
          value={params.dealType}
          allLabel={t("allDeal")}
          options={SHOP_LISTING_DEAL_TYPES.map((type) => ({
            value: type,
            label: t(`dealTypes.${type}`),
          }))}
        />
        <FilterSelect
          params={params}
          paramKey="keyMoney"
          value={params.keyMoney}
          allLabel={t("allKeyMoney")}
          options={SHOP_TRADE_KEY_MONEY_BANDS.map((band) => ({
            value: band.key,
            label: t(`keyMoneyBands.${band.key}`),
          }))}
        />

        {hasFilter && (
          <LocalizedClientLink
            href="/shop-trade"
            className="text-muted-foreground hover:text-foreground shrink-0 self-center px-2 text-sm underline"
          >
            {t("filterReset")}
          </LocalizedClientLink>
        )}
      </div>

      <div className="flex items-center justify-between gap-2">
        <p className="text-muted-foreground text-sm">
          {t("totalCount", { count: total })}
        </p>

        <div className="flex items-center gap-2">
          <PerPageSelect params={params} />

          <LocalizedClientLink
            href={buildListHref(params, { view: "grid", page: 1 })}
            aria-label={t("viewGrid")}
            className={viewButton(params.view === "grid")}
          >
            <LayoutGrid className="h-4 w-4" />
          </LocalizedClientLink>

          <LocalizedClientLink
            href={buildListHref(params, { view: "list", page: 1 })}
            aria-label={t("viewList")}
            className={viewButton(params.view === "list")}
          >
            <List className="h-4 w-4" />
          </LocalizedClientLink>
        </div>
      </div>
    </div>
  )
}
