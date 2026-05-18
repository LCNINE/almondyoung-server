"use client"

import { ChevronDown, ChevronUp } from "lucide-react"
import Image from "next/image"
import { useState } from "react"
import { useTranslations } from "next-intl"
import { cn } from "@lib/utils"
import { Button } from "@/components/ui/button"

type ProductInfo = {
  productNumber?: string
  weight?: string
  dimensions?: string
  origin?: string
  capacity?: string
  expirationDate?: string
  manufacturer?: string
  brand?: string
  material?: string
  usage?: string
  [key: string]: string | undefined
}

type Props = {
  productInfo: ProductInfo
  descriptionHtml?: string
  detailImages: string[]
  productName: string
}

const COLLAPSED_HEIGHT = 500

export function ProductDetailInfo({
  productInfo,
  descriptionHtml,
  detailImages,
  productName,
}: Props) {
  const t = useTranslations("productDetail.info")
  const [isExpanded, setIsExpanded] = useState(false)

  const infoFields = [
    { key: "productNumber", label: t("fieldProductNumber") },
    { key: "weight", label: t("fieldWeight") },
    { key: "dimensions", label: t("fieldDimensions") },
    { key: "origin", label: t("fieldOrigin") },
    { key: "capacity", label: t("fieldCapacity") },
    { key: "expirationDate", label: t("fieldExpirationDate") },
    { key: "manufacturer", label: t("fieldManufacturer") },
    { key: "brand", label: t("fieldBrand") },
    { key: "material", label: t("fieldMaterial") },
    { key: "usage", label: t("fieldUsage") },
  ]

  return (
    <article className="bg-white px-0 py-6 md:px-6">
      <header>
        <h3 className="mb-4 text-lg font-bold">{t("title")}</h3>
      </header>

      {/* 상품 정보 테이블 */}
      <dl className="grid grid-cols-1 gap-4 text-sm md:grid-cols-2">
        {infoFields.map(({ key, label }) => {
          const value = productInfo[key] || ""
          const isFullWidth = key === "material" || key === "usage"

          return (
            <div
              key={key}
              className={`border-b pb-2 ${isFullWidth ? "md:col-span-2" : ""}`}
            >
              <div className="flex">
                <dt
                  className={`text-gray-500 ${isFullWidth ? "mb-1 w-32" : "w-32"}`}
                >
                  {label}
                </dt>
                <dd className={`text-gray-900 ${isFullWidth ? "" : "flex-1"}`}>
                  {value}
                </dd>
              </div>
            </div>
          )
        })}
      </dl>

      {/* 상품 상세 정보 (접힘/펼침) */}
      <div className="relative mt-8">
        <div
          className={cn(
            "overflow-hidden transition-all duration-300",
            !isExpanded && "max-h-[500px]"
          )}
          style={isExpanded ? undefined : { maxHeight: COLLAPSED_HEIGHT }}
        >
          {descriptionHtml ? (
            <section>
              <h4 className="sr-only">{t("detailSrTitle")}</h4>
              <div
                className="prose max-w-none"
                dangerouslySetInnerHTML={{ __html: descriptionHtml }}
              />
            </section>
          ) : (
            <section className="space-y-4">
              <h4 className="sr-only">{t("detailImagesSrTitle")}</h4>
              {detailImages.map((image, idx) => (
                <figure key={idx} className="w-full overflow-hidden rounded-lg">
                  <Image
                    src={image}
                    alt={t("detailImageAlt", { name: productName, index: idx + 1 })}
                    className="h-auto w-full object-contain"
                    loading="lazy"
                    width={350}
                    height={350}
                    sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                    onError={(e) =>
                      console.error(t("imageLoadFail"), image, e)
                    }
                  />
                </figure>
              ))}
            </section>
          )}
        </div>

        {/* 그라데이션 오버레이 (접혀있을 때) */}
        {!isExpanded && (
          <div className="pointer-events-none absolute right-0 bottom-0 left-0 h-24 bg-linear-to-t from-white to-transparent" />
        )}
      </div>

      {/* 더보기/접기 버튼 */}
      <Button
        type="button"
        onClick={() => setIsExpanded((prev) => !prev)}
        className="mt-4 w-full cursor-pointer"
      >
        {isExpanded ? t("showLess") : t("showMore")}
        {isExpanded ? (
          <ChevronUp className="h-4 w-4" />
        ) : (
          <ChevronDown className="h-4 w-4" />
        )}
      </Button>
    </article>
  )
}
