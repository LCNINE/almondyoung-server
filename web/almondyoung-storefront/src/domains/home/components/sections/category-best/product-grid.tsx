import { ProductCard } from "@/components/products/prodcut-card"

interface ProductGridProps {
  products: number[]
  mockProductData: any
}

export function ProductGrid({ products, mockProductData }: ProductGridProps) {
  return (
    <div className="hidden grid-cols-3 gap-x-3 gap-y-8 md:grid md:grid-cols-4 lg:grid-cols-5">
      {products.slice(0, 10).map((i) => (
        <ProductCard key={i} rank={i} {...mockProductData} />
      ))}
    </div>
  )
}
