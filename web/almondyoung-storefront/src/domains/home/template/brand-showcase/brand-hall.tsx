"use client"

import LocalizedClientLink from "@/components/shared/localized-client-link"
import { cn } from "@/lib/utils"
import { useTranslations } from "next-intl"
import Image from "next/image"
import { useState } from "react"
import type { BrandHallProduct } from "./brand-hall-data"

export interface BrandHallBrand {
  id: string
  name: string
  href: string
  logoUrl: string | null
  /** thumbnail 은 이미 URL 로 resolve 된 값 */
  products: BrandHallProduct[]
}

interface BrandHallProps {
  brands: BrandHallBrand[]
}

/**
 * 왼쪽 ink 카드(고른 브랜드의 많이 팔린 상품 3개) + 오른쪽 로고 타일 판.
 * 타일을 누르면 카드만 바뀐다 — 상품은 서버에서 브랜드마다 미리 받아 와서 추가 요청이 없다.
 */
export function BrandHall({ brands }: BrandHallProps) {
  const t = useTranslations("home.brands")
  const [activeId, setActiveId] = useState(brands[0]?.id ?? "")
  const active = brands.find((brand) => brand.id === activeId) ?? brands[0]

  if (!active) return null

  return (
    <div className="grid gap-6 min-[760px]:grid-cols-[400px_minmax(0,1fr)]">
      <div className="bg-ink relative flex flex-col gap-4 overflow-hidden rounded-2xl p-6 text-white">
        <Image
          src="/images/logo-mark-white.png"
          alt=""
          aria-hidden
          width={200}
          height={200}
          className="pointer-events-none absolute -top-10 -right-[50px] w-[200px] opacity-[0.12]"
        />

        <div className="relative z-[1] flex items-center gap-3.5">
          <BrandLogo
            name={active.name}
            logoUrl={active.logoUrl}
            className="size-16 rounded-2xl border-0"
            sizes="64px"
          />
          <div className="min-w-0">
            <h3 className="truncate text-xl font-extrabold">{active.name}</h3>
            <p className="text-[13px] text-white/70">
              {active.products.length > 0
                ? t("featuredCaption")
                : t("emptyCaption")}
            </p>
          </div>
        </div>

        {active.products.length > 0 && (
          <ul className="relative z-[1] flex flex-col gap-2">
            {active.products.map((product) => (
              <li key={product.id}>
                <LocalizedClientLink
                  href={`/products/${product.handle}`}
                  className="grid grid-cols-[56px_minmax(0,1fr)_auto] items-center gap-3 rounded-[10px] bg-white/[0.07] p-2 transition-colors hover:bg-white/[0.13]"
                >
                  <span className="relative size-14 overflow-hidden rounded-lg bg-white">
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
                  <span className="line-clamp-2 text-[13px] leading-[1.35]">
                    {product.title}
                  </span>
                  <span className="flex flex-col items-end gap-0.5 whitespace-nowrap tabular-nums">
                    <span className="font-extrabold">
                      {product.price.toLocaleString()}원
                    </span>
                    {product.membershipPrice !== null && (
                      <span className="text-purple text-[12px] font-bold">
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
          className="bg-mint text-ink relative z-[1] mt-auto flex h-11 items-center justify-center rounded-[10px] font-extrabold"
        >
          {t("goToBrand", { name: active.name })}
        </LocalizedClientLink>
      </div>

      <div
        role="group"
        aria-label={t("ariaLabel")}
        className="scrollbar-hide -mx-4 grid auto-cols-[84px] grid-flow-col grid-rows-2 content-center gap-x-3 gap-y-2 overflow-x-auto px-4 [scrollbar-width:none] min-[760px]:mx-0 min-[760px]:auto-cols-auto min-[760px]:grid-flow-row min-[760px]:grid-cols-6 min-[760px]:grid-rows-none min-[760px]:overflow-visible min-[760px]:px-0 [&::-webkit-scrollbar]:hidden"
      >
        {brands.map((brand) => {
          const selected = brand.id === active.id

          return (
            <button
              key={brand.id}
              type="button"
              aria-pressed={selected}
              onClick={() => setActiveId(brand.id)}
              className={cn(
                "flex flex-col items-center gap-2 rounded-[14px] border px-1.5 py-3 text-center text-[13px] leading-[1.3] font-semibold transition-colors",
                selected
                  ? "border-ink text-foreground"
                  : "text-muted-foreground hover:bg-muted border-transparent"
              )}
            >
              <BrandLogo
                name={brand.name}
                logoUrl={brand.logoUrl}
                className="size-[60px] rounded-[18px] min-[760px]:size-[72px]"
                sizes="72px"
              />
              <span className="line-clamp-2 w-full">{brand.name}</span>
            </button>
          )
        })}
      </div>
    </div>
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
          className="object-contain"
        />
      ) : (
        <span className="text-muted-foreground line-clamp-2 px-1.5 text-center text-[11px] leading-tight font-bold">
          {name}
        </span>
      )}
    </span>
  )
}
