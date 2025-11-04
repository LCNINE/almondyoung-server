import { BasicProductCard } from "@components/products/product-card"
import { recommendedProducts } from "app/data/__mocks__/recommended-products.mock"

export function RecommendedProductsSection() {
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
        {recommendedProducts.map((product) => (
          <BasicProductCard
            key={product.id}
            product={product}
          />
        ))}
      </div>
    </section>
  )
}
