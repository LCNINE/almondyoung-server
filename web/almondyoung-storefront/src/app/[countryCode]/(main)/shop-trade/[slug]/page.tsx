import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { getTranslations } from "next-intl/server"
import { ChevronLeft } from "lucide-react"
import { toPlainSummary } from "@packages/shop-listing-markdown"
import LocalizedClientLink from "@/components/shared/localized-client-link"
import { SiteBreadcrumb } from "@/components/shared/site-breadcrumb"
import { Badge } from "@/components/ui/badge"
import { ShopListingMarkdown } from "@/domains/shop-trade/components/listing-markdown"
import { ListingGallery } from "@/domains/shop-trade/components/listing-gallery"
import { RelatedListings } from "@/domains/shop-trade/components/related-listings"
import { ShareButton } from "@/domains/shop-trade/components/share-button"
import { ViewBeacon } from "@/domains/shop-trade/components/view-beacon"
import { formatKoreanMoney } from "@/domains/shop-trade/format-money"
import { getPublicShopListing } from "@/lib/api/ugc/shop-listings"
import { getThumbnailUrl } from "@/lib/utils/get-thumbnail-url"
import { DATE_FORMATS, formatDate } from "@/lib/utils/format-date"

interface PageProps {
  params: Promise<{ countryCode: string; slug: string }>
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { countryCode, slug } = await params
  const listing = await getPublicShopListing(slug)

  if (!listing) {
    return {}
  }

  const description = toPlainSummary(listing.content)
  const thumbnailUrl = listing.thumbnailFileId
    ? getThumbnailUrl(listing.thumbnailFileId)
    : ""

  return {
    title: listing.title,
    description,
    alternates: { canonical: `/${countryCode}/shop-trade/${slug}` },
    openGraph: {
      title: listing.title,
      description,
      ...(thumbnailUrl ? { images: [thumbnailUrl] } : {}),
    },
  }
}

export default async function ShopTradeDetailPage({ params }: PageProps) {
  const { slug } = await params
  const t = await getTranslations("shopTrade")
  const listing = await getPublicShopListing(slug)

  if (!listing) {
    notFound()
  }

  const regionLabel = listing.region ? t(`regions.${listing.region}`) : null
  const money = (won: number | null) => formatKoreanMoney(won) ?? t("negotiable")

  const summary = [
    listing.dealType
      ? { label: t("dealLabel"), value: t(`dealTypes.${listing.dealType}`) }
      : null,
    listing.businessType
      ? {
          label: t("businessLabel"),
          value: t(`businessTypes.${listing.businessType}`),
        }
      : null,
    listing.areaPyeong
      ? { label: t("areaLabel"), value: t("pyeong", { n: listing.areaPyeong }) }
      : null,
    { label: t("keyMoneyLabel"), value: money(listing.keyMoney) },
    { label: t("depositLabel"), value: money(listing.deposit) },
    { label: t("monthlyRentLabel"), value: money(listing.monthlyRent) },
  ].filter(Boolean) as { label: string; value: string }[]

  return (
    <article className="container mx-auto max-w-[800px] px-3.5 py-6 xl:px-[40px]">
      <ViewBeacon slug={listing.slug} />
      <SiteBreadcrumb
        className="mb-4"
        items={[
          { label: t("title"), href: "/shop-trade" },
          { label: listing.title },
        ]}
      />

      {regionLabel && (
        <LocalizedClientLink
          href={`/shop-trade?region=${listing.region}`}
          className="text-primary text-sm font-medium"
        >
          {regionLabel}
        </LocalizedClientLink>
      )}

      <div className="mt-1 flex items-center gap-2">
        {listing.status === "closed" && (
          <Badge variant="secondary">{t("closed")}</Badge>
        )}
        <h1 className="text-foreground text-2xl font-bold">{listing.title}</h1>
      </div>

      <div className="border-border mt-3 flex items-center justify-between border-b pb-3">
        <p className="text-muted-foreground text-sm">
          {formatDate(listing.createdAt, DATE_FORMATS.KO_DOT)}
        </p>
        <ShareButton title={listing.title} />
      </div>

      {listing.imageFileIds.length > 0 && (
        <ListingGallery images={listing.imageFileIds} alt={listing.title} />
      )}

      <dl className="border-border mt-6 grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border p-4 sm:grid-cols-3">
        {summary.map((row) => (
          <div key={row.label}>
            <dt className="text-muted-foreground text-xs">{row.label}</dt>
            <dd className="text-foreground mt-0.5 text-sm font-semibold">
              {row.value}
            </dd>
          </div>
        ))}
      </dl>

      <ShopListingMarkdown content={listing.content} className="mt-6" />

      <RelatedListings current={listing} />

      <div className="mt-6 flex justify-center">
        <LocalizedClientLink
          href="/shop-trade"
          className="border-border text-foreground hover:bg-muted flex items-center gap-1.5 rounded-lg border px-4 py-2 text-sm transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
          {t("backToList")}
        </LocalizedClientLink>
      </div>
    </article>
  )
}
