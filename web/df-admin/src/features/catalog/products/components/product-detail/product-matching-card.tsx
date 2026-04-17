import { useMemo, useState } from "react"
import type { ProductDto, VariantDto } from "@/lib/types/catalog"
import {
  useMastersBatchStats,
  useVariantMatching,
} from "@/lib/services/matching/variant-mapping"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { VariantMatchingDialog } from "./variant-matching-dialog"

const STATUS_MAP: Record<
  string,
  {
    label: string
    variant: "default" | "secondary" | "destructive" | "outline"
  }
> = {
  matched: { label: "매칭됨", variant: "default" },
  pending: { label: "대기", variant: "secondary" },
  ignored: { label: "무시", variant: "outline" },
}

export function ProductMatchingCard({ product }: { product: ProductDto }) {
  const variants = product.variants ?? []
  const { data: stats } = useMastersBatchStats([product.masterId])
  const stat = stats?.[0]

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <div>
            <CardTitle className="text-base">상품 매칭</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              {stat
                ? `${stat.totalVariants}개 variant 중 ${stat.matchedVariants}개 매칭됨`
                : "variant별 SKU 매핑을 관리합니다"}
            </p>
          </div>
          {stat && (
            <Badge
              variant={stat.matchingRate === 100 ? "default" : "secondary"}
            >
              {stat.matchedVariants}/{stat.totalVariants} · {stat.matchingRate}%
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {variants.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            변형이 없습니다
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>옵션</TableHead>
                <TableHead>매칭 상태</TableHead>
                <TableHead>링크 수</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {variants.map((variant) => (
                <MatchingVariantRow
                  key={variant.id}
                  variant={variant}
                  masterId={product.masterId}
                />
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

function MatchingVariantRow({
  variant,
  masterId,
}: {
  variant: VariantDto
  masterId: string
}) {
  const { data, isLoading } = useVariantMatching(variant.id)
  const [open, setOpen] = useState(false)

  const statusInfo = useMemo(() => {
    const status = data?.status ?? "pending"
    return STATUS_MAP[status] ?? STATUS_MAP.pending
  }, [data?.status])

  return (
    <>
      <TableRow>
        <TableCell className="font-mono text-xs">
          {variant.sku || "-"}
        </TableCell>
        <TableCell className="max-w-[280px] text-xs">
          {variant.optionValues
            ?.map((ov) => `${ov.groupName}: ${ov.value}`)
            .join(", ") || "-"}
        </TableCell>
        <TableCell>
          <Badge variant={statusInfo.variant}>
            {isLoading ? "조회 중" : statusInfo.label}
          </Badge>
        </TableCell>
        <TableCell className="text-xs text-muted-foreground">
          {isLoading ? "-" : `${data?.links?.length ?? 0}개`}
        </TableCell>
        <TableCell className="text-right">
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            매핑 편집
          </Button>
        </TableCell>
      </TableRow>

      <VariantMatchingDialog
        open={open}
        onOpenChange={setOpen}
        variant={variant}
        masterId={masterId}
      />
    </>
  )
}
