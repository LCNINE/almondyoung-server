import Image from "next/image"
import Link from "next/link"
import { cn } from "@/lib/utils"

interface BannerProps {
  className?: string
  href: string
  pcSrc: string
  mobileSrc: string
  alt: string
}
export function Banner({
  className,
  href,
  pcSrc,
  mobileSrc,
  alt,
}: BannerProps) {
  return (
    <div
      className={cn(
        "relative h-[89px] w-full overflow-hidden md:h-[120px]",
        className
      )}
    >
      <Link href={href} className="block h-full w-full">
        {/* mobile image */}
        <Image
          className="object-cover transition-transform duration-300 hover:scale-105 md:hidden"
          src={mobileSrc}
          alt={alt}
          fill
          priority
        />

        {/* desktop image */}
        <Image
          className="hidden object-cover transition-transform duration-300 hover:scale-105 md:block"
          src={pcSrc}
          alt={alt}
          fill
          priority
        />
      </Link>
    </div>
  )
}
