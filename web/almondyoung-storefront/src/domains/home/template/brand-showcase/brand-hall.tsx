"use client"

import LocalizedClientLink from "@/components/shared/localized-client-link"
import { cn } from "@/lib/utils"
import { useTranslations } from "next-intl"
import { Noto_Serif_KR } from "next/font/google"
import Image from "next/image"
import { Skeleton } from "@/components/ui/skeleton"
import { useState, useTransition } from "react"
import { loadBrandFeaturedProducts } from "./brand-hall-actions"
import type { BrandHallProduct } from "./brand-hall-data"

const bannerSerif = Noto_Serif_KR({
  weight: "500",
  subsets: ["latin"],
  display: "swap",
})

export interface BrandHallBrand {
  id: string
  name: string
  href: string
  logoUrl: string | null
  /** 이 브랜드 상품을 받을 카테고리(자식 포함) */
  categoryIds: string[]
}

interface BrandHallProps {
  brands: BrandHallBrand[]
  /** 첫 브랜드 상품. thumbnail 은 이미 URL 로 resolve 된 값 */
  initialProducts: BrandHallProduct[]
  allBrandsHref: string
  /** 칸에 다 못 넣은 브랜드 수. 0 보다 크면 마지막 칸이 "전체 브랜드 +N" 이 된다 */
  moreCount: number
}

/**
 * 왼쪽 카드(고른 브랜드의 많이 팔린 상품 3개) + 오른쪽 로고 타일 판.
 * 첫 브랜드 상품만 서버에서 받아 오고, 다른 로고를 누르면 그때 받는다(받는 동안 스켈레톤).
 */
export function BrandHall({
  brands,
  initialProducts,
  allBrandsHref,
  moreCount,
}: BrandHallProps) {
  const t = useTranslations("home.brands")
  const [activeId, setActiveId] = useState(brands[0]?.id ?? "")
  const [productsById, setProductsById] = useState<
    Record<string, BrandHallProduct[]>
  >(() => (brands[0] ? { [brands[0].id]: initialProducts } : {}))
  const [, startLoading] = useTransition()
  const active = brands.find((brand) => brand.id === activeId) ?? brands[0]

  if (!active) return null

  const activeProducts = productsById[active.id]
  const isLoading = activeProducts === undefined

  const handleSelect = (brand: BrandHallBrand) => {
    setActiveId(brand.id)
    if (productsById[brand.id]) return

    startLoading(async () => {
      const products = await loadBrandFeaturedProducts(brand.categoryIds).catch(
        () => []
      )
      setProductsById((prev) => ({ ...prev, [brand.id]: products }))
    })
  }

  return (
    // 모바일은 고르는 곳(로고 줄)을 위, 결과(카드)를 아래에 둔다
    <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[400px_minmax(0,1fr)] lg:gap-6">
      <div className="border-border flex flex-col gap-1 rounded-2xl border bg-white p-4 text-black lg:gap-3 lg:p-6 lg:pb-5">
        <div className="flex items-center gap-3 lg:gap-3.5">
          <BrandLogo
            name={active.name}
            logoUrl={active.logoUrl}
            className="size-11 rounded-xl lg:size-14"
            sizes="56px"
          />
          <div className="min-w-0">
            <h3 className="truncate text-base font-bold lg:text-lg">
              {active.name}
            </h3>
            <p className="text-muted-foreground text-[13px]">
              {isLoading || activeProducts.length > 0
                ? t("featuredCaption")
                : t("emptyCaption")}
            </p>
          </div>
        </div>

        {isLoading && <BrandProductsSkeleton />}

        {!isLoading && activeProducts.length > 0 && (
          <ul className="flex flex-col divide-y divide-gray-100">
            {activeProducts.map((product) => (
              <li key={product.id}>
                <LocalizedClientLink
                  href={`/products/${product.handle}`}
                  className="group grid grid-cols-[48px_minmax(0,1fr)_auto] items-center gap-3 py-2.5 lg:grid-cols-[56px_minmax(0,1fr)_auto] lg:py-3"
                >
                  <span className="relative size-12 overflow-hidden rounded-lg border border-gray-100 bg-white lg:size-14">
                    {product.thumbnail && (
                      <Image
                        src={product.thumbnail}
                        alt=""
                        fill
                        sizes="56px"
                        className="object-contain"
                      />
                    )}
                  </span>
                  <span className="line-clamp-2 text-[13px] leading-[1.35] text-gray-700 group-hover:underline lg:text-sm">
                    {product.title}
                  </span>
                  <span className="flex flex-col items-end gap-0.5 whitespace-nowrap tabular-nums">
                    <span className="text-[14px] font-bold lg:text-[15px]">
                      {product.price.toLocaleString()}원
                    </span>
                    {product.membershipPrice !== null && (
                      <span className="text-primary text-[12px] font-bold">
                        {t("membershipPrice")}{" "}
                        {product.membershipPrice.toLocaleString()}원
                      </span>
                    )}
                  </span>
                </LocalizedClientLink>
              </li>
            ))}
          </ul>
        )}

        <LocalizedClientLink
          href={active.href}
          className="border-ink mt-auto flex h-11 items-center justify-center rounded-xl border bg-white text-sm font-bold transition-colors hover:bg-gray-50 lg:h-12 lg:text-[15px]"
        >
          {t("goToBrand", { name: active.name })}
        </LocalizedClientLink>
      </div>

      <div className="-order-1 flex min-w-0 flex-col gap-4 lg:order-none">
        <div
          role="group"
          aria-label={t("ariaLabel")}
          className="scrollbar-hide -mx-4 grid auto-cols-[68px] grid-flow-col content-center gap-x-1 gap-y-2 overflow-x-auto px-4 py-1 [scrollbar-width:none] lg:order-none lg:mx-0 lg:-mt-3 lg:auto-cols-auto lg:grid-flow-row lg:grid-cols-4 lg:grid-rows-none lg:content-start lg:overflow-visible lg:px-0 xl:grid-cols-6 [&::-webkit-scrollbar]:hidden"
        >
          {brands.map((brand) => {
            const selected = brand.id === active.id

            return (
              <button
                key={brand.id}
                type="button"
                aria-pressed={selected}
                onClick={() => handleSelect(brand)}
                className={cn(
                  "flex flex-col items-center gap-1.5 rounded-[14px] px-0.5 py-1.5 text-center text-xs leading-[1.3] break-keep transition-colors lg:gap-2 lg:px-1.5 lg:py-3 lg:text-[13px]",
                  selected
                    ? "font-bold text-black"
                    : "text-muted-foreground lg:hover:bg-muted font-semibold"
                )}
              >
                <BrandLogo
                  name={brand.name}
                  logoUrl={brand.logoUrl}
                  className={cn(
                    "size-14 rounded-2xl lg:size-[72px] lg:rounded-[18px]",
                    // 고른 브랜드는 로고 둘레에 흰 틈 + 주황 링
                    selected &&
                      "border-transparent shadow-[0_0_0_2px_#fff,0_0_0_4px_var(--mint)]"
                  )}
                  sizes="72px"
                />
                <span className="line-clamp-2 w-full">{brand.name}</span>
              </button>
            )
          })}

          {moreCount > 0 && (
            <LocalizedClientLink
              href={allBrandsHref}
              className="text-muted-foreground lg:hover:bg-muted flex flex-col items-center gap-1.5 rounded-[14px] px-0.5 py-1.5 text-center text-xs leading-[1.3] font-semibold break-keep transition-colors lg:gap-2 lg:px-1.5 lg:py-3 lg:text-[13px]"
            >
              <span className="border-border grid size-14 shrink-0 place-items-center rounded-2xl border bg-white text-base font-bold text-black tabular-nums lg:size-[72px] lg:rounded-[18px] lg:text-lg">
                +{moreCount}
              </span>
              {t("allBrands")}
            </LocalizedClientLink>
          )}
        </div>
        <div className="relative hidden min-h-[160px] flex-1 overflow-hidden rounded-2xl lg:block">
          <Image
            src="/images/brand-hall-mood.png"
            alt=""
            fill
            sizes="(min-width: 1280px) 830px, 60vw"
            className="object-cover object-right"
          />
          <div className="relative flex h-full flex-col justify-center gap-2.5 pl-10">
            <p
              className={cn(
                bannerSerif.className,
                "text-[26px] leading-none tracking-[-0.03em] text-[#3b2f24]"
              )}
            >
              {t("bannerTitle")}
            </p>
            <p className="text-[13px] tracking-[-0.01em] text-[#3b2f24]/65">
              {t("bannerCaption")}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

function BrandProductsSkeleton() {
  return (
    <ul aria-hidden className="flex flex-col divide-y divide-gray-100">
      {Array.from({ length: 3 }, (_, index) => (
        <li
          key={index}
          className="grid grid-cols-[48px_minmax(0,1fr)_56px] items-center gap-3 py-2.5 lg:grid-cols-[56px_minmax(0,1fr)_64px] lg:py-3"
        >
          <Skeleton className="size-12 rounded-lg lg:size-14" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-full" />
        </li>
      ))}
    </ul>
  )
}

function BrandLogo({
  name,
  logoUrl,
  className,
  sizes,
}: {
  name: string
  logoUrl: string | null
  className: string
  sizes: string
}) {
  return (
    <span
      className={cn(
        "border-border relative flex shrink-0 items-center justify-center overflow-hidden border bg-white",
        className
      )}
    >
      {logoUrl ? (
        <Image
          src={logoUrl}
          alt=""
          fill
          sizes={sizes}
          // 로고 이미지가 정사각형이 아니면 위아래가 비어 보여 칸을 꽉 채운다
          className="object-cover"
        />
      ) : (
        <span className="text-muted-foreground line-clamp-2 px-1.5 text-center text-[11px] leading-tight font-bold">
          {name}
        </span>
      )}
    </span>
  )
}
