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
  comingSoon,
}: {
  src: string
  alt: string
  action?: React.ReactNode
  rank?: React.ReactNode
  className?: string
  isSoldOut?: boolean
  comingSoon?: { date: string | null } | null
}) {
  return (
    <div
      className={cn(
        "relative aspect-square overflow-hidden bg-white",
        className
      )}
    >
      <Image
        src={getThumbnailUrl(src)}
        fill
        alt={alt}
        sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
        className="pointer-events-none h-full w-full object-contain p-3 transition-transform duration-300 will-change-transform select-none group-hover:scale-105 sm:p-4"
      />
      {rank}
      {isSoldOut && <SoldOutOverlay comingSoon={comingSoon} />}
      {action}
    </div>
  )
}
