"use client"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { deleteLineItems } from "@/lib/api/medusa/cart"
import { HttpTypes } from "@medusajs/types"
import { Loader2 } from "lucide-react"
import { useTransition } from "react"
import { toast } from "sonner"

import Item from "../components/item"

type ItemsProps = {
  items: HttpTypes.StoreCartLineItem[]
  selectedIds: Set<string>
  allSelected: boolean
  onSelectAll: (checked: boolean) => void
  onSelectItem: (itemId: string, checked: boolean) => void
}

export default function Items({
  items,
  selectedIds,
  allSelected,
  onSelectAll,
  onSelectItem,
}: ItemsProps) {
  const [isPending, startTransition] = useTransition()

  const handleDeleteSelected = () => {
    if (selectedIds.size === 0) return

    startTransition(async () => {
      try {
        await deleteLineItems(Array.from(selectedIds))
        toast.success(`${selectedIds.size}개 상품이 삭제되었습니다.`)
      } catch {
        toast.error("삭제에 실패했습니다. 다시 시도해주세요.")
      }
    })
  }

  return (
    <>
      {/* 선택 삭제 */}
      {items && items.length > 0 && (
        <div className="flex justify-end border-b pb-3">
          <Button
            variant="outline"
            size="sm"
            onClick={handleDeleteSelected}
            disabled={selectedIds.size === 0 || isPending}
          >
            {isPending ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : null}
            선택 삭제{selectedIds.size > 0 && ` (${selectedIds.size})`}
          </Button>
        </div>
      )}

      {/* 모바일: 카드 리스트 */}
      <div className="md:hidden">
        {items?.map((item) => (
          <div key={item.id} className="flex items-start gap-2">
            <div className="pt-5">
              <Checkbox
                checked={selectedIds.has(item.id)}
                onCheckedChange={(checked) =>
                  onSelectItem(item.id, checked === true)
                }
                disabled={isPending}
              />
            </div>
            <div className="flex-1">
              <Item item={item}>
                <Item.Mobile />
              </Item>
            </div>
          </div>
        ))}
      </div>

      {/* 데스크탑: 테이블 */}
      <div className="hidden md:block">
        <Table>
          <TableHeader className="border-t-0">
            <TableRow>
              <TableHead className="w-10 pl-0">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={onSelectAll}
                  disabled={isPending}
                />
              </TableHead>
              <TableHead className="w-24 pl-0">상품</TableHead>
              <TableHead></TableHead>
              <TableHead className="w-28">수량</TableHead>
              <TableHead className="hidden w-20 xl:table-cell">단가</TableHead>
              <TableHead className="w-20 text-right">합계</TableHead>
              <TableHead className="w-10 pr-0"></TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {items?.map((item) => (
              <Item
                key={item.id}
                item={item}
                selected={selectedIds.has(item.id)}
                onSelectChange={(checked) => onSelectItem(item.id, checked)}
                selectDisabled={isPending}
              >
                <Item.Desktop />
              </Item>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  )
}
