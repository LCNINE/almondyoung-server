import { Metadata } from "next"
import React from "react"

import { listCartOptions, retrieveCart } from "@lib/data/cart"
import { retrieveCustomer } from "@lib/api/medusa/customer"

import { getBaseURL } from "@lib/utils/env"
import { ThemeToggle } from "@components/common/thema-toggle"
import { DesktopHeader } from "@components/layout/components/header"

export const metadata: Metadata = {
  metadataBase: new URL(getBaseURL()),
}

export default async function CartLayout(props: { children: React.ReactNode }) {
  const user = null

  return (
    <div className="bg-muted flex min-h-screen flex-col">
      <DesktopHeader user={user} />

      <div className="container mx-auto py-8 md:max-w-[1360px] md:px-[40px]">
        {props.children}
      </div>

      {/* 임시 */}
      <ThemeToggle />
    </div>
  )
}
