import Image from "next/image"

export function ProductThumbnail({
  src,
  alt,
  rank,
  action,
}: {
  src: string
  alt: string
  rank?: number
  action?: React.ReactNode
}) {
  return (
    <div className="relative aspect-3/4 overflow-hidden rounded-tl-sm rounded-tr-xl rounded-br-xl rounded-bl-md bg-[#f4f4f4]">
      <Image
        src={src}
        fill
        alt={alt}
        className="pointer-events-none object-cover transition-transform duration-300 will-change-transform select-none group-hover:scale-105"
      />

      {rank && (
        <div className="absolute top-0 left-0 bg-black px-2.5 py-1 text-[12px] font-bold text-white">
          {rank}
        </div>
      )}

      {action}
    </div>
  )
}
