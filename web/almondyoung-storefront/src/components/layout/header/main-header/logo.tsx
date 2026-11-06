import { BrandLogo } from "@/components/shared/brand-logo"
import LocalizedClientLink from "@/components/shared/localized-client-link"

export function Logo() {
  return (
    <LocalizedClientLink href="" className="flex shrink-0 items-center">
      <BrandLogo
        appearance="light"
        className="h-7 w-auto xl:h-[38px]"
        priority
      />
    </LocalizedClientLink>
  )
}
