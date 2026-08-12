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
import { useTranslations } from "next-intl"
import { useTransition } from "react"
import { toast } from "sonner"

import Item from "../components/item"

type ItemsProps = {
  items: HttpTypes.StoreCartLineItem[]
  selectedIds: Set<string>
  allSelected: boolean
  onSelectAll: (checked: boolean) => void
  onSelectItem: (itemId: string, checked: boolean) => void
  /** 판매중단(draft/미게시)으로 결제를 막는 variant id 집합 */
  unavailableVariantIds?: Set<string>
  optionGoneVariantIds?: Set<string>
  soldOutVariantIds?: Set<string>
  /** 재고를 추적하는 variant 의 남은 수량 (없으면 상한 없음) */
  availableByVariantId?: Record<string, number>
}

export default function Items({
  items,
  selectedIds,
  allSelected,
  onSelectAll,
  onSelectItem,
  unavailableVariantIds,
  optionGoneVariantIds,
  soldOutVariantIds,
  availableByVariantId,
}: ItemsProps) {
  const [isPending, startTransition] = useTransition()
  const t = useTranslations("cart.items")

  const isItemUnavailable = (item: HttpTypes.StoreCartLineItem) =>
    !!item.variant_id && !!unavailableVariantIds?.has(item.variant_id)

  // 판매중단 · 옵션 삭제 · 품절은 고객이 취할 행동과 문구가 달라 구분해 안내한다.
  const unavailableReasonOf = (item: HttpTypes.StoreCartLineItem) => {
    if (!item.variant_id) return "product" as const
    if (optionGoneVariantIds?.has(item.variant_id)) return "option" as const
    if (soldOutVariantIds?.has(item.variant_id)) return "soldOut" as const
    return "product" as const
  }

  const maxQuantityOf = (item: HttpTypes.StoreCartLineItem) =>
    item.variant_id ? availableByVariantId?.[item.variant_id] : undefined

  const handleDeleteSelected = () => {
    if (selectedIds.size === 0) return

    startTransition(async () => {
      try {
        await deleteLineItems(Array.from(selectedIds))
        toast.success(t("deleteSelectedSuccess", { count: selectedIds.size }))
      } catch {
        toast.error(t("deleteSelectedError"))
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
            {selectedIds.size > 0
              ? t("deleteSelectedCount", { count: selectedIds.size })
              : t("deleteSelected")}
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
              <Item
                item={item}
                isUnavailable={isItemUnavailable(item)}
                unavailableReason={unavailableReasonOf(item)}
                maxQuantity={maxQuantityOf(item)}
              >
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
              <TableHead className="w-24 pl-0">{t("tableProduct")}</TableHead>
              <TableHead></TableHead>
              <TableHead className="w-28">{t("tableQuantity")}</TableHead>
              <TableHead className="hidden w-20 xl:table-cell">
                {t("tableUnitPrice")}
              </TableHead>
              <TableHead className="w-20 text-right">
                {t("tableTotal")}
              </TableHead>
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
                isUnavailable={isItemUnavailable(item)}
                unavailableReason={unavailableReasonOf(item)}
                maxQuantity={maxQuantityOf(item)}
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
