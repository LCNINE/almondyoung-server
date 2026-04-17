import { useParams, useNavigate } from "react-router-dom"
import { ArrowLeft } from "lucide-react"
import { useProduct } from "@/lib/services/catalog/products"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ProductInfoCard } from "../components/product-detail/product-info-card"
import { ProductMatchingCard } from "../components/product-detail/product-matching-card"
import { ProductVariantsCard } from "../components/product-detail/product-variants-card"
import { ProductImagesCard } from "../components/product-detail/product-images-card"
import { ProductVersionsCard } from "../components/product-detail/product-versions-card"

export default function ProductDetailTemplate() {
  const { masterId } = useParams<{ masterId: string }>()
  const navigate = useNavigate()
  const { data: product, isLoading } = useProduct(masterId!)

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 xl:grid-cols-[1fr_400px]">
          <div className="space-y-4">
            <Skeleton className="h-64 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
          <div className="space-y-4">
            <Skeleton className="h-48 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        </div>
      </div>
    )
  }

  if (!product) {
    return (
      <div className="py-12 text-center">
        <p className="text-muted-foreground">상품을 찾을 수 없습니다</p>
        <Button
          variant="outline"
          className="mt-4"
          onClick={() => navigate("/catalog/products")}
        >
          목록으로 돌아가기
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate("/catalog/products")}
        >
          <ArrowLeft className="mr-1 h-4 w-4" />
          목록
        </Button>
        <h1 className="text-lg font-bold">{product.name}</h1>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_400px]">
        <div className="space-y-4">
          <ProductInfoCard product={product} />
          <ProductVariantsCard product={product} />
          <ProductMatchingCard product={product} />
        </div>
        <div className="space-y-4">
          <ProductImagesCard product={product} />
          <ProductVersionsCard masterId={masterId!} />
        </div>
      </div>
    </div>
  )
}
