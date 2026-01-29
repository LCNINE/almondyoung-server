import { cn } from "@lib/utils"
import Image from "next/image"

export function ProductThumbnail({
  src,
  alt,
  action,
  rank,
  className,
}: {
  src: string
  alt: string
  action?: React.ReactNode
  rank?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "relative aspect-3/4 overflow-hidden bg-[#f4f4f4]",
        className
      )}
    >
      {/* todo: Image 태그로 왜 안되는지는 모르겠는데, 나중에 확인후 변경 예정 */}
      <img
        src={src}
        // fill
        alt={alt}
        className="pointer-events-none h-full object-cover transition-transform duration-300 will-change-transform select-none group-hover:scale-105"
      />
      {rank}
      {action}
    </div>
  )
}
