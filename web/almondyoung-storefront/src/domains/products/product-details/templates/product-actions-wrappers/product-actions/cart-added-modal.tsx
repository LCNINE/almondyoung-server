"use client"

import LocalizedClientLink from "@/components/shared/localized-client-link"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { getThumbnailUrl } from "@/lib/utils/get-thumbnail-url"
import { HttpTypes } from "@medusajs/types"
import Image from "next/image"

interface CartAddedModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  product: HttpTypes.StoreProduct
}

export default function CartAddedModal({
  open,
  onOpenChange,
  product,
}: CartAddedModalProps) {
  const thumbnail = product.thumbnail || product.images?.[0]?.url

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>장바구니 담기 완료</DialogTitle>
          <DialogDescription className="sr-only">
            상품이 장바구니에 담겼습니다
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-3 py-2">
          {thumbnail && (
            <Image
              src={getThumbnailUrl(thumbnail)}
              alt={product.title || ""}
              width={56}
              height={56}
              className="h-14 w-14 rounded-md object-cover"
            />
          )}
          <span className="flex-1 text-sm">장바구니에 상품을 담았어요</span>
          <LocalizedClientLink
            href={"/cart"}
            className="text-primary hover:text-primary/80 text-sm font-medium whitespace-nowrap"
          >
            바로가기
          </LocalizedClientLink>
        </div>
      </DialogContent>
    </Dialog>
  )
}
