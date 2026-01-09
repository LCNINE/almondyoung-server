import { ThemeToggle } from "@components/common/thema-toggle"

import { MainHeader } from "@components/layout/components/header/main-header"
import { getBaseURL } from "@lib/utils/env"
import { Metadata } from "next"

export const metadata: Metadata = {
  metadataBase: new URL(getBaseURL()),
}

export default function MainLayout(props: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <MainHeader />

      {props.children}

      <ThemeToggle />
    </div>
  )
}
