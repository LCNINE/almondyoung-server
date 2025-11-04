"use client"

import { usePathname } from "next/navigation"
import { ResponsiveFooter } from "./footer"

export function ConditionalFooter() {
  const pathname = usePathname()
  
  // products 경로에서는 footer를 숨김
  if (pathname.includes("/products/")) {
    return null
  }
  
  return <ResponsiveFooter className="w-[100vw]" />
}
