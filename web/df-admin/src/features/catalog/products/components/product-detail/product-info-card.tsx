import type { ProductDto } from "@/lib/types/catalog"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

const STATUS_LABEL: Record<string, string> = {
  active: "활성",
  inactive: "비활성",
  draft: "초안",
}

export function ProductInfoCard({ product }: { product: ProductDto }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">기본 정보</CardTitle>
          <Badge variant={product.status === "active" ? "default" : "secondary"}>
            {STATUS_LABEL[product.status] ?? product.status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <InfoRow label="상품명" value={product.name} />
        <InfoRow label="브랜드" value={product.brand} />
        <InfoRow label="설명" value={product.description} />
        <InfoRow label="상품코드" value={product.productCode} />
        <InfoRow label="상품유형" value={product.productType} />
        <div className="flex gap-2">
          {product.isWholesaleOnly && (
            <Badge variant="outline">도매전용</Badge>
          )}
          {product.isMembershipOnly && (
            <Badge variant="outline">멤버십전용</Badge>
          )}
        </div>
        {product.priceSummary && (
          <div className="rounded-md bg-muted p-3">
            <p className="text-xs font-medium text-muted-foreground">가격 범위</p>
            <p className="text-sm">
              {product.priceSummary.minBasePrice.toLocaleString("ko-KR")}원
              {product.priceSummary.minBasePrice !==
                product.priceSummary.maxBasePrice &&
                ` ~ ${product.priceSummary.maxBasePrice.toLocaleString("ko-KR")}원`}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function InfoRow({
  label,
  value,
}: {
  label: string
  value?: string | null
}) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="text-sm">{value || "-"}</p>
    </div>
  )
}
