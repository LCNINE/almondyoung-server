import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
import { WithHeaderLayout } from "@components/layout"
import { getSubscriptionHistoryPaged } from "@lib/api/membership"
import { getTranslations } from "next-intl/server"
import HistoryList from "./history-list"

export default async function MembershipHistoryPage() {
  const t = await getTranslations("mypage.membership")
  const { items, total } = await getSubscriptionHistoryPaged(10, 0).catch(
    () => ({ items: [], total: 0 })
  )

  return (
    <WithHeaderLayout
      config={{
        showDesktopHeader: true,
        showMobileHeader: false,
        showMobileSubBackHeader: true,
        mobileSubBackHeaderTitle: t("history.subscriptionHistory"),
      }}
    >
      <MypageLayout>
        <div className="bg-white px-4 py-6 md:px-0">
          <div className="mx-auto w-full max-w-2xl">
            <h1 className="text-foreground mb-4 text-lg font-bold">
              {t("history.subscriptionHistory")}
            </h1>
            <HistoryList initialItems={items} initialTotal={total} />
          </div>
        </div>
      </MypageLayout>
    </WithHeaderLayout>
  )
}
