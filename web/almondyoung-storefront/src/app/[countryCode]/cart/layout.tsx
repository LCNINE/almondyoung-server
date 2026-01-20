import { Metadata } from "next"
import React from "react"
// import { DesktopHeader } from "@/components/layout/header/cart-header"
import { getBaseURL } from "@lib/utils/env"

export const metadata: Metadata = {
  metadataBase: new URL(getBaseURL()),
}

export default async function CartLayout(props: { children: React.ReactNode }) {
  return (
    <div className="bg-muted flex min-h-screen flex-col">
      {/* <DesktopHeader /> */}

      <div className="container mx-auto py-8 md:max-w-[1360px] md:px-[40px]">
        {props.children}
      </div>
    </div>
  )
}
