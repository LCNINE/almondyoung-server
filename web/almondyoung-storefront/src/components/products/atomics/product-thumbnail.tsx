"use client"

import Image from "next/image"
import { ShoppingCart } from "lucide-react"

type ProductThumbnailProps = {
  src: string
  alt: string
  showCartIcon?: boolean
  timer?: string
  rankInfo?: { show: boolean; rank: number }
  isSoldOut?: boolean
  onCartClick?: () => void
  className?: string
}

export const ProductThumbnail = ({
  src,
  alt,
  showCartIcon = false,
  timer,
  rankInfo,
  isSoldOut = false,
  onCartClick,
  className = "",
}: ProductThumbnailProps) => {
  return (
    <div
      className={`group relative aspect-3/4 overflow-hidden rounded-tl-sm rounded-tr-xl rounded-br-xl rounded-bl-md bg-gray-100 ${className}`}
    >
      <Image
        src={src}
        fill
        alt={alt}
        className="pointer-events-none select-none object-cover transition-transform duration-300 group-hover:scale-105"
      />

      {rankInfo?.show && (
        <div className="absolute left-0 top-0 bg-black px-2.5 py-1 text-[12px] font-bold text-white">
          {rankInfo.rank}
        </div>
      )}

      {timer && (
        <div className="absolute left-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-[11px] font-semibold text-white">
          {timer}
        </div>
      )}

      {isSoldOut && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/45 text-sm font-semibold text-white">
          품절
        </div>
      )}

      {showCartIcon && !isSoldOut && (
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault()
            onCartClick?.()
          }}
          aria-label="장바구니 담기"
          className="absolute bottom-2 right-2 inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/90 shadow transition hover:bg-white"
        >
          <ShoppingCart className="h-4 w-4 text-gray-700" />
        </button>
      )}
    </div>
  )
}
