import Image from "next/image"
import type { CSSProperties } from "react"
import LocalizedClientLink from "@/components/shared/localized-client-link"
import { cn } from "@/lib/utils"
import { getThumbnailUrl } from "@/lib/utils/get-thumbnail-url"

interface BannerDimensions {
  pc: { width: number | null; height: number | null }
  mobile: { width: number | null; height: number | null }
}

interface BannerProps {
  className?: string
  href?: string | null
  pcSrc: string
  mobileSrc: string
  alt: string
  dimensions?: BannerDimensions
  hideOnMobile?: boolean
}

export function Banner({
  className,
  href,
  pcSrc,
  mobileSrc,
  alt,
  dimensions,
  hideOnMobile,
}: BannerProps) {
  const pcImageUrl = getThumbnailUrl(pcSrc)
  const mobileImageUrl = getThumbnailUrl(mobileSrc)
  const isExternal = href?.startsWith("http://") || href?.startsWith("https://")

  const pcW = dimensions?.pc.width
  const pcH = dimensions?.pc.height
  const mW = dimensions?.mobile.width
  const mH = dimensions?.mobile.height

  const hasPcRatio = !!(pcW && pcH)
  const hasMobileRatio = !!(mW && mH)
  const useAspectRatio = hasPcRatio || hasMobileRatio

  const wrapperClass = cn(
    useAspectRatio
      ? "relative w-full overflow-hidden"
      : "relative h-[89px] w-full overflow-hidden md:h-[120px]",
    hasMobileRatio && "aspect-(--banner-m-ratio)",
    hasPcRatio && "md:aspect-(--banner-pc-ratio)",
    hideOnMobile && "hidden md:block",
    className
  )

  const wrapperStyle = useAspectRatio
    ? ({
        ...(hasMobileRatio && { "--banner-m-ratio": `${mW}/${mH}` }),
        ...(hasPcRatio && { "--banner-pc-ratio": `${pcW}/${pcH}` }),
      } as CSSProperties)
    : undefined

  const images = (
    <>
      {!hideOnMobile && (
        <Image
          className="object-cover transition-transform duration-300 md:hidden"
          src={mobileImageUrl}
          alt={alt}
          fill
          priority
          sizes="(max-width: 767px) 100vw, 0px"
        />
      )}

      <Image
        className={cn(
          "object-cover transition-transform duration-300",
          hideOnMobile ? "block" : "hidden md:block"
        )}
        src={pcImageUrl}
        alt={alt}
        fill
        priority
        sizes={hideOnMobile ? "100vw" : "(max-width: 767px) 0px, 100vw"}
      />
    </>
  )

  return (
    <div className={wrapperClass} style={wrapperStyle}>
      {href ? (
        isExternal ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="block h-full w-full"
          >
            {images}
          </a>
        ) : (
          <LocalizedClientLink href={href} className="block h-full w-full">
            {images}
          </LocalizedClientLink>
        )
      ) : (
        images
      )}
    </div>
  )
}
