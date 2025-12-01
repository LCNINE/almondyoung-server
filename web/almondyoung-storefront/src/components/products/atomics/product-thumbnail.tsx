"use client"

import React from "react"
import { ShoppingCart } from "lucide-react"

export const ProductThumbnail = ({
  src,
  alt,
  rankInfo: { show, rank },
  timer,
  showCartIcon,
  onCartClick,
  isSoldOut,
}: {
  src: string
  alt: string
  rankInfo: { show: boolean; rank: number }
  timer?: string
  showCartIcon?: boolean
  onCartClick?: () => void
  isSoldOut?: boolean
}) => (
  <div
    className={
      show
        ? "bg-muted relative aspect-[1/1] w-full overflow-hidden rounded-tl-[5px] rounded-tr-[15px] rounded-br-[15px] rounded-bl-[15px] md:rounded-[5px]"
        : "bg-muted relative aspect-[1/1] w-full overflow-hidden rounded-[15px] md:rounded-[5px]"
    }
  >
    <img src={src || "/placeholder.png"} alt={alt} className="h-full w-full object-cover" />
    {show && (
      <span className="absolute top-0 left-0 z-10 flex items-center justify-center bg-black/80 text-white md:bg-black">
        <span className="flex h-7 w-7 items-center justify-center text-xs md:h-7 md:w-7 md:pt-[7px] md:pr-[11px] md:pb-[9px] md:pl-[11px] md:text-base">
          {rank}
        </span>
      </span>
    )}
    {timer && (
      <div className="absolute bottom-0 left-0 w-full bg-black/70 py-1 text-center text-xs text-white md:text-lg md:leading-normal md:font-normal">
        {timer}
      </div>
    )}
    {showCartIcon && !isSoldOut && (
      <div className="absolute right-2 bottom-2 md:right-3 md:bottom-3">
        <button
          onClick={onCartClick}
          className="bg-background/80 group relative flex h-[26px] w-[26px] items-center justify-center rounded-full shadow-lg transition-shadow hover:shadow-xl md:h-[40px] md:w-[40px]"
        >
          <ShoppingCart
            className="h-4 w-4 text-gray-800 md:h-6 md:w-6"
            strokeWidth={1.6}
          />
        </button>
      </div>
    )}
  </div>
)
