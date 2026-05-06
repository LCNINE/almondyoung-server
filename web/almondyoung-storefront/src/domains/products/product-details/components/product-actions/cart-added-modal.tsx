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
import { Loader2 } from "lucide-react"
import Image from "next/image"

interface CartAddedModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  product: HttpTypes.StoreProduct
  isPending?: boolean
}

export default function CartAddedModal({
  open,
  onOpenChange,
  product,
  isPending = false,
}: CartAddedModalProps) {
  const thumbnail = product.thumbnail || product.images?.[0]?.url

  // isPending 동안엔 사용자가 ESC/배경 클릭으로 닫지 못하게 (요청 도중 닫혀서 결과 못 보는 상황 방지)
  const handleOpenChange = (next: boolean) => {
    if (isPending && !next) return
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isPending ? "장바구니에 담는 중" : "장바구니 담기 완료"}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {isPending
              ? "장바구니에 상품을 담고 있습니다"
              : "상품이 장바구니에 담겼습니다"}
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
          <span className="flex-1 text-sm">
            {isPending ? "장바구니에 담는 중..." : "장바구니에 상품을 담았어요"}
          </span>
          {isPending ? (
            <span
              className="text-muted-foreground flex items-center gap-1 text-sm font-medium whitespace-nowrap"
              aria-live="polite"
            >
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="sr-only">처리 중</span>
            </span>
          ) : (
            <LocalizedClientLink
              href={"/cart"}
              className="text-primary hover:text-primary/80 text-sm font-medium whitespace-nowrap"
            >
              바로가기
            </LocalizedClientLink>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
