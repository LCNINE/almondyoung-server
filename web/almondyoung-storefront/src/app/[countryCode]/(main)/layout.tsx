import { ThemeToggle } from "@components/common/thema-toggle"

import { getBaseURL } from "@lib/utils/env"
import { Metadata } from "next"

export const metadata: Metadata = {
  metadataBase: new URL(getBaseURL()),
}

export default async function MainLayout(props: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      {props.children}

      <ThemeToggle />
    </div>
  )
}
