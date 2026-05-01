import { Metadata } from "next"

import { getBaseURL } from "@lib/utils/env"

export const metadata: Metadata = {
  metadataBase: new URL(getBaseURL()),
}

export default async function PageLayout(props: { children: React.ReactNode }) {
  return (
    <>
      <div id="menu-root" className="relative z-150 overflow-visible"></div>
      <div>{props.children}</div>
    </>
  )
}
