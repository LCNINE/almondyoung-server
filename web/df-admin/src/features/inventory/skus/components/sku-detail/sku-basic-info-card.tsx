import type { SkuDto } from "@/lib/types/inventory"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

const STOCK_TYPE_LABEL: Record<SkuDto["stockType"], string> = {
  physical: "사입",
  infinite: "무제한",
  drop_shipped: "직배",
  consignment: "위탁",
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  )
}

export function SkuBasicInfoCard({ sku }: { sku: SkuDto }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">기본 정보</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Row label="SKU 코드" value={<span className="font-mono">{sku.code || "-"}</span>} />
        <Row label="이름" value={sku.name} />
        <Row label="옵션" value={sku.optionKey ?? "-"} />
        <Row
          label="재고 유형"
          value={<Badge variant="secondary">{STOCK_TYPE_LABEL[sku.stockType]}</Badge>}
        />
        <Row label="안전재고" value={sku.safetyStock} />
        <Row label="MOQ" value={sku.moq ?? "-"} />
        <Row label="한글 상품명" value={sku.koreanName ?? "-"} />
        <Row
          label="공급사"
          value={
            sku.suppliers.length > 0
              ? sku.suppliers.map((s) => s.name).join(", ")
              : "-"
          }
        />
        <Row
          label="카테고리"
          value={
            sku.categoryNames.length > 0 ? sku.categoryNames.join(", ") : "-"
          }
        />
        <Row label="상품 설명" value={sku.productDescription ?? "-"} />
      </CardContent>
    </Card>
  )
}
