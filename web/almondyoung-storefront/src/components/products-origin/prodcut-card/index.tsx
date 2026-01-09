import { ProductCardProps } from "@/lib/types/ui/product"
import testImg from "@assets/images/test.png"
import Link from "next/link"
import { ProductInfo } from "./parts/product-info"
import { ProductThumbnail } from "./parts/product-thumbnail"
import { QuickCartButton } from "./parts/quick-cart-button"

export function ProductCard(props: ProductCardProps) {
  return (
    <div className="group flex cursor-pointer flex-col gap-2">
      {/* todo: 상품 상세 페이지 링크 추가 */}
      <Link href={`#`}>
        <ProductThumbnail
          src={testImg.src} // todo: 이미지 소스 추가
          alt={props.title}
          rank={props.rank}
          action={<QuickCartButton />}
        />
        <ProductInfo {...props} />
      </Link>
    </div>
  )
}
