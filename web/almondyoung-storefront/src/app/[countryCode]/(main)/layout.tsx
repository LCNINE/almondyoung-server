import { ThemeToggle } from "@components/common/thema-toggle"

import { getBaseURL } from "@lib/utils/env"
import { Metadata } from "next"
import { MainHeaderWrapper } from "@components/layout/main-header-wrapper"

export const metadata: Metadata = {
  metadataBase: new URL(getBaseURL()),
}

export default async function MainLayout(props: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <MainHeaderWrapper />
      {props.children}

      <ThemeToggle />
    </div>
  )
}
