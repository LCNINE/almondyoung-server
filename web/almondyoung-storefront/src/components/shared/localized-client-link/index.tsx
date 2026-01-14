"use client"

import Link from "next/link"
import { useParams } from "next/navigation"
import React from "react"

/**
 * 이 컴포넌트는 Next.js `<Link />`를 생성하여 현재 국가 코드를 URL에 유지합니다.
 * prop으로 명시적으로 전달할 필요 없이 사용할 수 있습니다.
 */
const LocalizedClientLink = ({
  children,
  href,
  ...props
}: {
  children?: React.ReactNode
  href: string
  className?: string
  onClick?: () => void
  passHref?: true
  [x: string]: any
}) => {
  const { countryCode } = useParams()

  return (
    <Link href={`/${countryCode}${href}`} {...props}>
      {children}
    </Link>
  )
}

export default LocalizedClientLink
