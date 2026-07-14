"use client"

import Image from "next/image"
import Link from "next/link"
import { useParams } from "next/navigation"

export function Logo({ tone = "light" }: { tone?: "light" | "dark" }) {
  const { countryCode } = useParams()

  if (tone === "dark") {
    return (
      <Link
        href={`/${countryCode}`}
        className="flex h-12 items-center text-[28px] leading-none font-black tracking-normal whitespace-nowrap text-[#3f3a34] italic"
      >
        ALMOND
        <span className="border-primary mx-1 inline-flex h-8 w-5 rotate-12 items-center justify-center rounded-[50%] border-[3px] text-transparent">
          O
        </span>
        YOUNG
      </Link>
    )
  }

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
