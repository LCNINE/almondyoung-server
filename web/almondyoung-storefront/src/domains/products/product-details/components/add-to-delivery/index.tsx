"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"

import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  listAddToDeliveryParents,
  type AddToDeliveryParent,
} from "@lib/api/medusa/add-to-delivery"

interface AddToDeliveryButtonProps {
  productId: string
  enabled: boolean
  disabled: boolean
  onPick: (parentOrderId: string) => void
}

/** 출고 전 주문이 있으면 이 상품을 배송비 없이 그 주문과 같은 상자로 받는 버튼. 부모가 여럿이면 배송지를 고른다. */
export default function AddToDeliveryButton({
  productId,
  enabled,
  disabled,
  onPick,
}: AddToDeliveryButtonProps) {
  const t = useTranslations("productDetail.addToDelivery")
  const [parents, setParents] = useState<AddToDeliveryParent[]>([])
  const [sheetOpen, setSheetOpen] = useState(false)

  useEffect(() => {
    if (!enabled) return

    let alive = true

    listAddToDeliveryParents(productId).then((list) => {
      if (alive) setParents(list)
    })

    return () => {
      alive = false
    }
  }, [productId, enabled])

  if (!enabled || parents.length === 0) return null

  const handleClick = () => {
    if (parents.length === 1) {
      onPick(parents[0].orderId)

      return
    }

    setSheetOpen(true)
  }

  return (
    <div className="flex w-full flex-col gap-1">
      <Button
        variant="secondary"
        onClick={handleClick}
        disabled={disabled}
        className="h-12 w-full cursor-pointer text-base font-medium"
        data-testid="add-to-delivery-button"
      >
        {t("button")}
      </Button>
      {parents.length === 1 && (
        <p className="text-muted-foreground text-center text-xs">
          {t("hint", { displayId: parents[0].displayId })}
        </p>
      )}

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="bottom" className="rounded-t-3xl">
          <SheetHeader>
            <SheetTitle>{t("sheetTitle")}</SheetTitle>
            <SheetDescription>{t("sheetDesc")}</SheetDescription>
          </SheetHeader>
          <ul className="flex flex-col gap-2 px-4 pb-6">
            {parents.map((p) => (
              <li key={p.orderId}>
                <button
                  type="button"
                  onClick={() => {
                    setSheetOpen(false)
                    onPick(p.orderId)
                  }}
                  className="border-border hover:bg-muted flex w-full flex-col gap-1 rounded-xl border px-4 py-3 text-left"
                  data-testid="add-to-delivery-parent"
                >
                  <span className="text-sm font-bold">
                    {t("orderLine", { displayId: p.displayId })}
                  </span>
                  <span className="text-muted-foreground text-sm">
                    {[p.address.name, p.address.address1, p.address.address2]
                      .filter(Boolean)
                      .join(" ")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </SheetContent>
      </Sheet>
    </div>
  )
}
