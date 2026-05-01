"use client"

import Image from "next/image"
import Link from "next/link"
import { useParams } from "next/navigation"

export function Logo() {
  const { countryCode } = useParams()

  return (
    <Link href={`/${countryCode}`}>
      <div className="relative h-10 w-[170px] md:w-[200px] lg:h-[45px] lg:w-[287px]">
        <Image
          src="/images/almond_white_logo.svg"
          alt="아몬드영"
          width={287}
          height={45}
          className="h-full w-full object-contain"
          priority
        />
      </div>
    </Link>
  )
}
