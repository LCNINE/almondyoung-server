import { useMemo, useState } from "react"
import { createColumnHelper } from "@tanstack/react-table"
import { MoreHorizontal } from "lucide-react"
import { DateCell } from "@/components/table-cells/date-cell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import type { OrderLineRow } from "@/lib/types/matching"
import { ChangeStrategyDialog } from "../components/change-strategy-dialog"
import { ResolveMatchingDialog } from "../components/resolve-matching-dialog"
import { SetPriorityDialog } from "../components/set-priority-dialog"
import { StockPolicyDialog } from "../components/stock-policy-dialog"

const columnHelper = createColumnHelper<OrderLineRow>()

const STATUS_MAP: Record<
  string,
  {
    label: string
    variant: "default" | "secondary" | "destructive" | "outline"
  }
> = {
  pending: { label: "대기", variant: "secondary" },
  matched: { label: "매칭됨", variant: "default" },
  ignored: { label: "무시", variant: "outline" },
  unregistered: { label: "미등록", variant: "destructive" },
}

export function useOrderLineTableColumns() {
  return useMemo(
    () => [
      columnHelper.accessor("salesChannel", {
        header: "채널",
        cell: ({ getValue }) => (
          <span className="text-sm">{getValue() || "-"}</span>
        ),
      }),
      columnHelper.accessor("channelOrderId", {
        header: "주문번호",
        cell: ({ getValue }) => (
          <span className="font-mono text-xs">{getValue()}</span>
        ),
      }),
      columnHelper.accessor("orderDate", {
        header: "주문일",
        cell: ({ getValue }) => <DateCell value={getValue()} />,
      }),
      columnHelper.accessor("productName", {
        header: "상품명",
        cell: ({ row }) => (
          <div className="space-y-1">
            <p className="max-w-[260px] truncate font-medium">
              {row.original.productName}
            </p>
            <p className="text-xs text-muted-foreground">
              고객 {row.original.customerName || "-"}
            </p>
          </div>
        ),
      }),
      columnHelper.display({
        id: "option-quantity",
        header: "옵션/수량",
        cell: ({ row }) => (
          <div className="space-y-1 text-xs">
            <p className="font-mono text-muted-foreground">
              variant {row.original.variantId}
            </p>
            <p>{row.original.quantity}개</p>
          </div>
        ),
      }),
      columnHelper.display({
        id: "matching-status",
        header: "매칭상태",
        cell: ({ row }) => {
          const status = row.original.matchingStatus ?? "unregistered"
          const info = STATUS_MAP[status]
          return <Badge variant={info.variant}>{info.label}</Badge>
        },
      }),
      columnHelper.display({
        id: "matched-skus",
        header: "매칭된 SKU",
        cell: ({ row }) => {
          if (row.original.matchedSkus.length === 0) {
            return <span className="text-xs text-muted-foreground">-</span>
          }

          return (
            <div className="space-y-1">
              {row.original.matchedSkus.map((sku) => (
                <div key={sku.skuId} className="text-xs">
                  <span className="font-medium">{sku.skuName}</span>
                  <span className="ml-1 text-muted-foreground">
                    x{sku.quantity}
                  </span>
                  {sku.skuCode && (
                    <span className="ml-1 font-mono text-muted-foreground">
                      {sku.skuCode}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )
        },
      }),
      columnHelper.display({
        id: "priority",
        header: "우선순위",
        cell: ({ row }) => (
          <Badge
            variant={
              row.original.matchingStatus === "pending"
                ? "secondary"
                : "outline"
            }
            className={cn(
              row.original.matchingStatus === "pending" && "font-medium"
            )}
          >
            {row.original.matchingStatus === "pending"
              ? "높음/보통 변경 가능"
              : "확정됨"}
          </Badge>
        ),
      }),
      columnHelper.display({
        id: "actions",
        header: "",
        cell: ({ row }) => <OrderLineActions row={row.original} />,
      }),
    ],
    []
  )
}

function OrderLineActions({ row }: { row: OrderLineRow }) {
  const [resolveOpen, setResolveOpen] = useState(false)
  const [priorityOpen, setPriorityOpen] = useState(false)
  const [strategyOpen, setStrategyOpen] = useState(false)
  const [stockPolicyOpen, setStockPolicyOpen] = useState(false)

  const isPending = row.matchingStatus === "pending"
  const hasMatching = !!row.matchingId

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            disabled={!isPending}
            onSelect={() => setResolveOpen(true)}
          >
            매칭 해소
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!isPending}
            onSelect={() => setPriorityOpen(true)}
          >
            우선순위 변경
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!isPending}
            onSelect={() => setStrategyOpen(true)}
          >
            전략 변경
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!hasMatching}
            onSelect={() => setStockPolicyOpen(true)}
          >
            재고 정책
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ResolveMatchingDialog
        open={resolveOpen}
        onOpenChange={setResolveOpen}
        row={row}
      />
      <SetPriorityDialog
        open={priorityOpen}
        onOpenChange={setPriorityOpen}
        row={row}
      />
      <ChangeStrategyDialog
        open={strategyOpen}
        onOpenChange={setStrategyOpen}
        row={row}
      />
      <StockPolicyDialog
        open={stockPolicyOpen}
        onOpenChange={setStockPolicyOpen}
        row={row}
      />
    </>
  )
}
