import { ChevronLeft, ChevronRight } from "lucide-react"
import { getTranslations } from "next-intl/server"
import LocalizedClientLink from "@/components/shared/localized-client-link"
import { cn } from "@/lib/utils"
import { buildListHref, type ShopTradeListParams } from "../../build-list-href"

const WINDOW = 5

export async function Pagination({
  params,
  totalPages,
}: {
  params: ShopTradeListParams
  totalPages: number
}) {
  const t = await getTranslations("shopTrade")

  if (totalPages <= 1) return null

  const start = Math.max(1, Math.min(params.page - 2, totalPages - WINDOW + 1))
  const end = Math.min(totalPages, start + WINDOW - 1)
  const pages = Array.from({ length: end - start + 1 }, (_, i) => start + i)

  const box =
    "flex h-9 min-w-9 items-center justify-center rounded-lg border px-2 text-sm transition-colors"

  return (
    <nav className="mt-8 flex items-center justify-center gap-1.5">
      {params.page > 1 && (
        <LocalizedClientLink
          href={buildListHref(params, { page: params.page - 1 })}
          aria-label={t("prevPage")}
          className={cn(
            box,
            "border-border text-muted-foreground hover:text-foreground"
          )}
        >
          <ChevronLeft className="h-4 w-4" />
        </LocalizedClientLink>
      )}

      {pages.map((page) => (
        <LocalizedClientLink
          key={page}
          href={buildListHref(params, { page })}
          aria-current={page === params.page ? "page" : undefined}
          className={cn(
            box,
            page === params.page
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border text-muted-foreground hover:text-foreground"
          )}
        >
          {page}
        </LocalizedClientLink>
      ))}

      {params.page < totalPages && (
        <LocalizedClientLink
          href={buildListHref(params, { page: params.page + 1 })}
          aria-label={t("nextPage")}
          className={cn(
            box,
            "border-border text-muted-foreground hover:text-foreground"
          )}
        >
          <ChevronRight className="h-4 w-4" />
        </LocalizedClientLink>
      )}
    </nav>
  )
}
