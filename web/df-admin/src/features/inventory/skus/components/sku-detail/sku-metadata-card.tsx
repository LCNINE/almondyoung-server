import type { SkuDto } from "@/lib/types/inventory"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  )
}

function dim(n?: number | null) {
  return n == null ? "-" : n
}

export function SkuMetadataCard({ sku }: { sku: SkuDto }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">물리 속성 / 메모</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Row label="무게 (g)" value={dim(sku.productWeight)} />
        <Row
          label="치수 (W×H×D cm)"
          value={`${dim(sku.dimensionWidth)} × ${dim(sku.dimensionHeight)} × ${dim(sku.dimensionDepth)}`}
        />
        <Row label="소재" value={sku.productMaterial ?? "-"} />
        <Row label="메모 2" value={sku.memo2 ?? "-"} />
        <Row label="메모 3" value={sku.memo3 ?? "-"} />
      </CardContent>
    </Card>
  )
}
