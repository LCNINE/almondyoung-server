import type { ProductDto } from "@/lib/types/catalog"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ImageIcon } from "lucide-react"

export function ProductImagesCard({ product }: { product: ProductDto }) {
  const images = product.images ?? []

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">이미지</CardTitle>
      </CardHeader>
      <CardContent>
        {product.thumbnail || images.length > 0 ? (
          <div className="grid grid-cols-3 gap-2">
            {product.thumbnail && (
              <div className="relative aspect-square overflow-hidden rounded-md border">
                <img
                  src={product.thumbnail}
                  alt="썸네일"
                  className="h-full w-full object-cover"
                />
                <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 text-[10px] text-white">
                  대표
                </span>
              </div>
            )}
            {images.map((img) => (
              <div
                key={img.id}
                className="aspect-square overflow-hidden rounded-md border"
              >
                <img
                  src={img.url ?? ""}
                  alt=""
                  className="h-full w-full object-cover"
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
            <ImageIcon className="mb-2 h-8 w-8" />
            <p className="text-sm">등록된 이미지가 없습니다</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
