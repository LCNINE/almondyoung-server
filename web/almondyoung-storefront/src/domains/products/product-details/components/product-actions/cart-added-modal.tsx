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
import { useTranslations } from "next-intl"

interface CartAddedModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  product: HttpTypes.StoreProduct
  isPending?: boolean
  /** 화면이 보여준 가격과 실제로 담긴 가격이 다를 때만 준다. */
  priceChange?: { from: number; to: number } | null
}

export default function CartAddedModal({
  open,
  onOpenChange,
  product,
  isPending = false,
  priceChange = null,
}: CartAddedModalProps) {
  const t = useTranslations("productDetail.cartModal")
  const thumbnail = product.thumbnail || product.images?.[0]?.url

  const handleOpenChange = (next: boolean) => {
    if (isPending && !next) return
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isPending ? t("addingTitle") : t("addedTitle")}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {isPending ? t("addingDesc") : t("addedDesc")}
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
            {isPending ? t("addingBody") : t("addedBody")}
          </span>
          {isPending ? (
            <span
              className="text-muted-foreground flex items-center gap-1 text-sm font-medium whitespace-nowrap"
              aria-live="polite"
            >
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="sr-only">{t("processingSr")}</span>
            </span>
          ) : (
            <LocalizedClientLink
              href={"/cart"}
              className="text-primary hover:text-primary/80 text-sm font-medium whitespace-nowrap"
            >
              {t("goToCart")}
            </LocalizedClientLink>
          )}
        </div>

        {!isPending && priceChange && (
          <p className="text-red-30 text-[13px] font-bold">
            {t("priceChanged", {
              from: priceChange.from.toLocaleString(),
              to: priceChange.to.toLocaleString(),
            })}
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}
