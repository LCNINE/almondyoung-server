import { WithHeaderLayout } from "@components/layout"
import MypageLayout from "@components/layout/mypage-layout"
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
        showDesktopHeader: true,
        showMobileHeader: false,
      }}
    >
      <MypageLayout>
        <SettingClient />
      </MypageLayout>
    </WithHeaderLayout>
  )
}
