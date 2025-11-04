import { WithHeaderLayout } from "@components/layout"
import { SettingClient } from "domains/settings/setting-client"
import { Metadata } from "next"

export const metadata: Metadata = {
  title: "설정",
  description: "샵 정보를 설정하세요",
}

export default function SettingPage() {
  return (
    <WithHeaderLayout
      config={{
        showDesktopHeader: false,
        showMobileHeader: false,
      }}
    >
      <SettingClient />
    </WithHeaderLayout>
  )
}
