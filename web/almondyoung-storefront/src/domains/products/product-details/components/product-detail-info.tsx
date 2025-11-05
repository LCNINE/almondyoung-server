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
  detailImages: string[]
  productName: string
}

/**
 * @description 상품 상세 정보 섹션
 * 시맨틱: <article>과 <dl> 사용
 */
export function ProductDetailInfo({
  productInfo,
  detailImages,
  productName,
}: Props) {
  const infoFields = [
    { key: "productNumber", label: "상품번호" },
    { key: "weight", label: "상품 무게" },
    { key: "dimensions", label: "상품 규격" },
    { key: "origin", label: "원산지" },
    { key: "capacity", label: "용량" },
    { key: "expirationDate", label: "유효일자" },
    { key: "manufacturer", label: "제조사" },
    { key: "brand", label: "브랜드" },
    { key: "material", label: "소재" },
    { key: "usage", label: "사용방법" },
  ]

  return (
    <article className="bg-white px-0 py-6 md:px-6">
      <header>
        <h3 className="mb-4 text-lg font-bold">상품정보</h3>
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

      {/* 상품 상세 이미지 */}
      <section className="mt-8 space-y-4">
        <h4 className="sr-only">상품 상세 이미지</h4>
        {detailImages.map((image, idx) => (
          <figure key={idx} className="w-full overflow-hidden rounded-lg">
            <img
              src={image}
              alt={`${productName} 상세 이미지 ${idx + 1}`}
              className="h-auto w-full object-contain"
              loading="lazy"
              onError={(e) => console.error("이미지 로드 실패:", image, e)}
            />
          </figure>
        ))}
      </section>
    </article>
  )
}
