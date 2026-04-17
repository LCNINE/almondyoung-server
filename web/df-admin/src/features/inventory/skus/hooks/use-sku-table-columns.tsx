import { createColumnHelper } from "@tanstack/react-table"
import { useMemo } from "react"
import type { SkuDto, StockType } from "@/lib/types/inventory"
import { DateCell } from "@/components/table-cells/date-cell"
import { BadgeCell } from "@/components/table-cells/badge-cell"

const columnHelper = createColumnHelper<SkuDto>()

const STOCK_TYPE_MAP: Record<
  StockType,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  physical: { label: "사입", variant: "default" },
  infinite: { label: "무제한", variant: "secondary" },
  drop_shipped: { label: "직배", variant: "outline" },
  consignment: { label: "위탁", variant: "outline" },
}

export function useSkuTableColumns() {
  return useMemo(
    () => [
      columnHelper.accessor("code", {
        header: "SKU 코드",
        cell: ({ getValue }) => (
          <span className="font-mono text-xs">{getValue() || "-"}</span>
        ),
      }),
      columnHelper.accessor("name", {
        header: "이름",
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            {row.original.mainImageUrl && (
              <img
                src={row.original.mainImageUrl}
                alt=""
                className="h-8 w-8 rounded object-cover"
              />
            )}
            <span className="max-w-[220px] truncate font-medium">
              {row.original.name}
            </span>
          </div>
        ),
      }),
      columnHelper.accessor("optionKey", {
        header: "옵션",
        cell: ({ getValue }) => (
          <span className="text-xs text-muted-foreground">
            {getValue() ?? "-"}
          </span>
        ),
      }),
      columnHelper.accessor("stockType", {
        header: "재고 유형",
        cell: ({ getValue }) => (
          <BadgeCell value={getValue()} map={STOCK_TYPE_MAP} />
        ),
      }),
      columnHelper.accessor("safetyStock", {
        header: "안전재고",
        cell: ({ getValue }) => (
          <span className="text-sm tabular-nums">{getValue() ?? 0}</span>
        ),
      }),
      columnHelper.accessor("currentStock", {
        header: "현재고",
        cell: ({ getValue }) => (
          <span className="text-sm tabular-nums">{getValue() ?? 0}</span>
        ),
      }),
      columnHelper.accessor("barcodes", {
        header: "바코드",
        cell: ({ getValue }) => {
          const bs = getValue()
          if (!bs?.length)
            return <span className="text-muted-foreground">-</span>
          const primary = bs.find((b) => b.isPrimary) ?? bs[0]
          const extra = bs.length - 1
          return (
            <span className="font-mono text-xs">
              {primary.barcode}
              {extra > 0 && (
                <span className="ml-1 text-muted-foreground">+{extra}</span>
              )}
            </span>
          )
        },
      }),
      columnHelper.accessor("suppliers", {
        header: "공급사",
        cell: ({ getValue }) => {
          const ss = getValue()
          if (!ss?.length)
            return <span className="text-muted-foreground">-</span>
          return (
            <span className="max-w-[140px] truncate text-sm">
              {ss.map((s) => s.name).join(", ")}
            </span>
          )
        },
      }),
      columnHelper.accessor("updatedAt", {
        header: "수정일",
        cell: ({ getValue }) => <DateCell value={getValue()} />,
      }),
    ],
    [],
  )
}
