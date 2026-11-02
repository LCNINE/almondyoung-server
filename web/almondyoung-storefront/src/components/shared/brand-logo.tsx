import Image from "next/image"

type BrandLogoProps = {
  appearance?: "light" | "dark" | "header"
  alt?: string
  className?: string
  priority?: boolean
}

export function BrandLogo({
  appearance = "light",
  alt = "아몬드영",
  className,
  priority = false,
}: BrandLogoProps) {
  if (appearance === "header") {
    return (
      <span className={className}>
        <Image
          src="/images/almondyoung-logo-on-light.png"
          alt={alt}
          width={512}
          height={107}
          className="brand-logo-header-light h-auto w-full"
          priority={priority}
        />
        <Image
          src="/images/almondyoung-logo-on-dark.png"
          alt={alt}
          width={512}
          height={107}
          className="brand-logo-header-dark h-auto w-full"
          priority={priority}
        />
      </span>
    )
  }

  return (
    <Image
      src={
        appearance === "dark"
          ? "/images/almondyoung-logo-on-dark.png"
          : "/images/almondyoung-logo-on-light.png"
      }
      alt={alt}
      width={512}
      height={107}
      className={className}
      priority={priority}
    />
  )
}
