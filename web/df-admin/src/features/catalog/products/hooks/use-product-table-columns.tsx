import { createColumnHelper } from "@tanstack/react-table"
import { useMemo } from "react"
import type { ProductSummaryDto } from "@/lib/types/catalog"
import { DateCell } from "@/components/table-cells/date-cell"
import { BadgeCell } from "@/components/table-cells/badge-cell"
import { Checkbox } from "@/components/ui/checkbox"

const columnHelper = createColumnHelper<ProductSummaryDto>()

const STATUS_MAP: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  active: { label: "활성", variant: "default" },
  inactive: { label: "비활성", variant: "secondary" },
  draft: { label: "초안", variant: "outline" },
}

export function useProductTableColumns() {
  return useMemo(
    () => [
      columnHelper.display({
        id: "select",
        header: ({ table }) => (
          <Checkbox
            checked={
              table.getIsAllPageRowsSelected() ||
              (table.getIsSomePageRowsSelected() && "indeterminate")
            }
            onCheckedChange={(value) =>
              table.toggleAllPageRowsSelected(!!value)
            }
            aria-label="전체 선택"
            onClick={(e) => e.stopPropagation()}
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(value) => row.toggleSelected(!!value)}
            aria-label="행 선택"
            onClick={(e) => e.stopPropagation()}
          />
        ),
      }),
      columnHelper.accessor("name", {
        header: "상품명",
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            {row.original.thumbnail && (
              <img
                src={row.original.thumbnail}
                alt=""
                className="h-8 w-8 rounded object-cover"
              />
            )}
            <span className="max-w-[200px] truncate font-medium">
              {row.original.name}
            </span>
          </div>
        ),
      }),
      columnHelper.accessor("brand", {
        header: "브랜드",
        cell: ({ getValue }) => (
          <span className="text-sm">{getValue() ?? "-"}</span>
        ),
      }),
      columnHelper.accessor("status", {
        header: "상태",
        cell: ({ getValue }) => (
          <BadgeCell value={getValue()} map={STATUS_MAP} />
        ),
      }),
      columnHelper.accessor("variantCount", {
        header: "변형 수",
        cell: ({ getValue }) => (
          <span className="text-sm">{getValue()}</span>
        ),
      }),
      columnHelper.accessor("priceSummary", {
        header: "가격",
        cell: ({ getValue }) => {
          const ps = getValue()
          if (!ps) return <span className="text-muted-foreground">-</span>
          const fmt = (n: number) => n.toLocaleString("ko-KR")
          return (
            <span className="text-sm">
              {ps.minBasePrice === ps.maxBasePrice
                ? `${fmt(ps.minBasePrice)}원`
                : `${fmt(ps.minBasePrice)} ~ ${fmt(ps.maxBasePrice)}원`}
            </span>
          )
        },
      }),
      columnHelper.accessor("createdAt", {
        header: "생성일",
        cell: ({ getValue }) => <DateCell value={getValue()} />,
      }),
    ],
    [],
  )
}
