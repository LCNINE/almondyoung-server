import LocalizedClientLink from "@/components/shared/localized-client-link"
import { getTranslations } from "next-intl/server"

// 무한스크롤만 있으면 2페이지 이후 상품에 도달할 URL 이 없어 크롤러가 첫 12개만 본다.
// 페이지 카운터는 두지 않는다 — 스크롤로 몇 페이지를 봐도 URL 의 page 는 그대로라
// "1 / 33" 이 계속 떠서 실제 본 양과 어긋난다.
export async function CategoryPaginationLinks({
  baseUrl,
  page,
  lastPage,
}: {
  baseUrl: string
  page: number
  lastPage: number
}) {
  const t = await getTranslations("category.products")
  const href = (n: number) => (n <= 1 ? baseUrl : `${baseUrl}?page=${n}`)

  return (
    <nav
      aria-label={t("paginationLabel")}
      className="mt-10 flex items-center justify-center gap-3 border-t pt-6 text-sm"
    >
      {page > 1 && (
        <LocalizedClientLink
          href={href(page - 1)}
          rel="prev"
          className="text-muted-foreground hover:text-primary"
        >
          {t("prevPage")}
        </LocalizedClientLink>
      )}
      {page < lastPage && (
        <LocalizedClientLink
          href={href(page + 1)}
          rel="next"
          className="text-muted-foreground hover:text-primary"
        >
          {t("nextPage")}
        </LocalizedClientLink>
      )}
    </nav>
  )
}
