import LocalizedClientLink from "@/components/shared/localized-client-link"
import { getTranslations } from "next-intl/server"

interface SearchCorrectionNoticeProps {
  keyword: string
  correctedQuery?: string
  relatedKeywords?: string[]
}

export async function SearchCorrectionNotice({
  keyword,
  correctedQuery,
  relatedKeywords = [],
}: SearchCorrectionNoticeProps) {
  const t = await getTranslations("search.result")
  const hasCorrection = Boolean(correctedQuery)
  const hasRelated = relatedKeywords.length > 0

  if (!hasCorrection && !hasRelated) return null

  return (
    <div className="mb-5 md:mb-6">
      {hasCorrection && (
        <div className="space-y-0.5 text-[13px] leading-relaxed text-foreground md:space-y-1 md:text-sm">
          <p>
            {t.rich("correctedTitle", {
              corrected: correctedQuery ?? "",
              strong: (chunks) => <span className="font-bold">{chunks}</span>,
            })}
          </p>
          <p className="text-muted-foreground">
            {t.rich("searchOriginal", {
              original: keyword,
              link: (chunks) => (
                <LocalizedClientLink
                  href={`/search?q=${encodeURIComponent(keyword)}&correct=false`}
                  className="font-medium text-primary underline underline-offset-2"
                >
                  {chunks}
                </LocalizedClientLink>
              ),
            })}
          </p>
        </div>
      )}

      {hasRelated && (
        <div
          className={`flex flex-wrap items-baseline gap-x-2.5 gap-y-1 text-[13px] md:gap-x-3 md:gap-y-1.5 md:text-sm ${
            hasCorrection ? "mt-2.5 border-t border-border pt-2.5 md:mt-3 md:pt-3" : ""
          }`}
        >
          <span className="shrink-0 text-muted-foreground">
            {t("relatedTitle")}:
          </span>
          {relatedKeywords.map((related) => (
            <LocalizedClientLink
              key={related}
              href={`/search?q=${encodeURIComponent(related)}`}
              className="text-primary hover:underline"
            >
              {related}
            </LocalizedClientLink>
          ))}
        </div>
      )}
    </div>
  )
}
