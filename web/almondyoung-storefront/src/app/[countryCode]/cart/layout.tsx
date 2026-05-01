import { Metadata } from "next"
import React from "react"
import { MainHeader } from "@/components/layout/header/main-header"
import { MobileBackHeader } from "@/components/layout/header/m-back-header"
import { getBaseURL } from "@lib/utils/env"

export const metadata: Metadata = {
  metadataBase: new URL(getBaseURL()),
}

export default async function CartLayout(props: { children: React.ReactNode }) {
  return (
    <div className="bg-muted flex min-h-screen flex-col">
      {/* PC 헤더 */}
      <div className="hidden md:block">
        <MainHeader />
      </div>

      {/* 모바일 헤더 */}
      <div className="md:hidden">
        <MobileBackHeader title="장바구니" />
      </div>

      <div className="container mx-auto pt-16 md:max-w-[1360px] md:px-[40px] md:py-8 md:pt-8">
        {props.children}
      </div>
    </div>
  )
}
