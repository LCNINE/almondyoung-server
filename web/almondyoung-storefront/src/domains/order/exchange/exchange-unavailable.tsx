import { CustomButton } from "@/components/shared/custom-buttons"
import LocalizedClientLink from "@/components/shared/localized-client-link"
import { PageTitle } from "@/components/shared/page-title"
import { getTranslations } from "next-intl/server"

/**
 * 교환 신청 안내 (K8 PR 10). 옛 core 교환 길을 걷었고 Medusa 교환(K8 PR 11)이 열릴 때까지 교환은 고객센터가 받는다.
 * 주문의 교환 버튼은 core 가 `exchange` 액션을 내지 않아 안 보인다 — 이 화면은 옛 링크·직접 URL 로 들어온 경우다.
 */
export async function ExchangeUnavailable({ orderId }: { orderId?: string }) {
  const t = await getTranslations("mypage.order.exchangeUnavailable")
  return (
    <div className="bg-white px-4 py-8 md:min-h-screen md:px-6">
      <PageTitle>{t("title")}</PageTitle>
      <p className="mt-6 text-foreground">{t("body")}</p>
      <div className="mt-6 flex gap-2">
        <LocalizedClientLink href="/mypage/inquiries">
          <CustomButton variant="fill" color="primary" size="md">
            {t("inquiry")}
          </CustomButton>
        </LocalizedClientLink>
        {orderId ? (
          <LocalizedClientLink href={`/mypage/order/details?orderId=${encodeURIComponent(orderId)}`}>
            <CustomButton variant="outline" color="secondary" size="md">
              {t("orderDetail")}
            </CustomButton>
          </LocalizedClientLink>
        ) : null}
      </div>
    </div>
  )
}
