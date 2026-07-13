import { cn } from "@lib/utils"
import { getThumbnailUrl } from "@lib/utils/get-thumbnail-url"
import { SoldOutOverlay } from "@/components/products/sold-out-overlay"
import Image from "next/image"

export function ProductThumbnail({
  src,
  alt,
  action,
  rank,
  className,
  isSoldOut = false,
}: {
  src: string
  alt: string
  action?: React.ReactNode
  rank?: React.ReactNode
  className?: string
  isSoldOut?: boolean
}) {
  return (
    <div
      className={cn(
        "relative aspect-square overflow-hidden bg-[#f4f4f4]",
        className
      )}
    >
      <Image
        src={getThumbnailUrl(src)}
        fill
        alt={alt}
        sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
        className="pointer-events-none h-full object-cover transition-transform duration-300 will-change-transform select-none group-hover:scale-105"
      />
      {rank}
      {isSoldOut && <SoldOutOverlay />}
      {action}
    </div>
  )
}
