import { useSkuStockSummary } from "@/lib/services/inventory/skus"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Skeleton } from "@/components/ui/skeleton"

export function SkuStockSummaryCard({ skuId }: { skuId: string }) {
  const { data, isLoading } = useSkuStockSummary(skuId)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">재고 요약</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : !data ? (
          <p className="text-sm text-muted-foreground">재고 정보가 없습니다.</p>
        ) : (
          <>
            <div className="mb-3 grid grid-cols-3 gap-3 text-sm">
              <div>
                <p className="text-muted-foreground">실재고</p>
                <p className="tabular-nums text-base font-semibold">
                  {data.totalRealQuantity.toLocaleString("ko-KR")}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">예약</p>
                <p className="tabular-nums text-base font-semibold">
                  {data.totalReservedQuantity.toLocaleString("ko-KR")}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">가용</p>
                <p className="tabular-nums text-base font-semibold">
                  {data.totalAvailableQuantity.toLocaleString("ko-KR")}
                </p>
              </div>
            </div>
            {data.warehouseStocks.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>창고</TableHead>
                    <TableHead className="text-right">실재고</TableHead>
                    <TableHead className="text-right">예약</TableHead>
                    <TableHead className="text-right">가용</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.warehouseStocks.map((w) => (
                    <TableRow key={w.warehouseId}>
                      <TableCell>{w.warehouseName}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {w.realQuantity.toLocaleString("ko-KR")}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {w.reservedQuantity.toLocaleString("ko-KR")}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {w.availableQuantity.toLocaleString("ko-KR")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
