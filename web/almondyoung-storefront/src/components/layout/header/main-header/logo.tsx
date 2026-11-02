"use client"

import Image from "next/image"
import Link from "next/link"
import { useParams } from "next/navigation"

export function Logo() {
  const { countryCode } = useParams()

  return (
    <Link
      href={`/${countryCode}`}
      className="flex h-10 shrink-0 items-center rounded bg-white px-2 lg:h-[45px]"
    >
      <Image
        src="/images/almondyoung-logo.png"
        alt="아몬드영"
        width={512}
        height={107}
        className="h-auto w-[140px] object-contain md:w-[160px]"
        priority
      />
    </Link>
  )
}
