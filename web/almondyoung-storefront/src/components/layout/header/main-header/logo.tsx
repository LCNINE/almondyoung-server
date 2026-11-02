"use client"

import { BrandLogo } from "@/components/shared/brand-logo"
import Link from "next/link"
import { useParams } from "next/navigation"

export function Logo() {
  const { countryCode } = useParams()

  return (
    <Link
      href={`/${countryCode}`}
      className="flex h-10 shrink-0 items-center lg:h-[45px]"
    >
      <BrandLogo
        appearance="header"
        className="block w-[160px] md:w-[184px]"
        priority
      />
    </Link>
  )
}
