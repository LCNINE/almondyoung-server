import type { ProductDto } from "@/lib/types/catalog"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export function ProductVariantsCard({ product }: { product: ProductDto }) {
  const variants = product.variants ?? []

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">변형 ({variants.length})</CardTitle>
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
                <TableHead>가격</TableHead>
                <TableHead>상태</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {variants.map((v) => (
                <TableRow key={v.id}>
                  <TableCell className="font-mono text-xs">
                    {v.sku || "-"}
                  </TableCell>
                  <TableCell className="text-xs">
                    {v.optionValues
                      ?.map((ov) => `${ov.groupName}: ${ov.value}`)
                      .join(", ") || "-"}
                  </TableCell>
                  <TableCell className="text-xs">
                    {v.price
                      ? `${v.price.basePrice.toLocaleString("ko-KR")}원`
                      : "-"}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        v.status === "active" ? "default" : "secondary"
                      }
                      className="text-xs"
                    >
                      {v.status === "active" ? "활성" : "비활성"}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
