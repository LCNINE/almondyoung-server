import type { ProductCard } from "@lib/types/ui/product"

// TODO: 실제 추천 제품 API 연동 필요
const recommendedProducts: ProductCard[] = []

export function RecommendedProductsSection() {
  if (recommendedProducts.length === 0) {
    return null
  }

  return (
    <section
      aria-labelledby="recommended-products-heading"
      className="rounded-[10px] bg-white p-6"
    >
      <h3
        id="recommended-products-heading"
        className="mb-4 text-[18px] font-bold"
      >
        원장님을 위한 추천제품
      </h3>
      <div className="grid grid-cols-3 gap-4 lg:grid-cols-6">
        {/* {recommendedProducts.map((product) => (
          // <BasicProductCard
          //   key={product.id}
          //   product={product}
          // />
        ))} */}
      </div>
    </section>
  )
}
