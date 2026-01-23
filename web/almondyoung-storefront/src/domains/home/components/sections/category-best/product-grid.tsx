import { ProductCard } from "@/components/products/prodcut-card"
import Link from "next/link"
import { useParams } from "next/navigation"

interface ProductGridProps {
  products: number[]
  mockProductData: any
}

export function ProductGrid({ products, mockProductData }: ProductGridProps) {
  const params = useParams() as { countryCode?: string }
  const countryCode = params?.countryCode || "kr"

  return (
    <div className="hidden grid-cols-3 gap-x-3 gap-y-8 md:grid md:grid-cols-4 lg:grid-cols-5">
      {products.slice(0, 10).map((i) => (
        <Link key={i} href={`/${countryCode}/products/${i}`} className="block">
          <ProductCard rank={i} {...mockProductData} />
        </Link>
      ))}
    </div>
  )
}
