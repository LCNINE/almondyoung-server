"use client"

import Link, { type LinkProps } from "next/link"
import { useParams } from "next/navigation"
import React from "react"

type Props = Omit<LinkProps, "href"> &
  Omit<React.ComponentPropsWithoutRef<"a">, keyof LinkProps | "href"> & {
    children?: React.ReactNode
    href: string
  }

/**
 * 현재 국가 코드를 URL 에 유지하는 `<Link />`.
 */
const LocalizedClientLink = ({ children, href, ...props }: Props) => {
  const { countryCode } = useParams()
  // 동적 세그먼트는 string[] 로도 올 수 있다. 그대로 넣으면 "a,b" 로 직렬화된다.
  const region = Array.isArray(countryCode) ? countryCode[0] : countryCode

  return (
    <Link href={region ? `/${region}${href}` : href} {...props}>
      {children}
    </Link>
  )
}

export default LocalizedClientLink
