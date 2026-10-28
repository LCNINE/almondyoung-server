import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
import { CustomButton } from "@/components/shared/custom-buttons"
import LocalizedClientLink from "@/components/shared/localized-client-link"
import { PageTitle } from "@/components/shared/page-title"
import { ApiAuthError } from "@lib/api/api-error"
import { getOrder } from "@/lib/api/medusa/orders"
import { getReturnable } from "@/lib/api/medusa/returns"
import { getSEOTags } from "@/lib/seo"
import { buildAddressLine } from "@/lib/utils/address-line"
import { getThumbnailUrl } from "@/lib/utils/get-thumbnail-url"
import { WithHeaderLayout } from "@components/layout"
import { unstable_rethrow } from "next/navigation"
import { getTranslations } from "next-intl/server"
import { ExchangeClient } from "../../../../../domains/order/exchange/exchange-client"
import { ReturnRequestClient } from "../../../../../domains/order/return-request/return-request-client"
import {
  buildReturnFormLines,
  type ReturnFormLine,
} from "../../../../../domains/order/return-request/return-request-form"

export async function generateMetadata() {
  const t = await getTranslations("mypage.menu")
  return getSEOTags({
    title: t("exchange"),
    openGraph: {},
  })
}

interface ExchangePageProps {
  searchParams: Promise<{ orderId?: string; type?: string; itemId?: string }>
}

export default async function ExchangePage({ searchParams }: ExchangePageProps) {
  const t = await getTranslations("mypage.menu")
  const { orderId, type, itemId } = await searchParams
  return (
    <WithHeaderLayout
      config={{
        showDesktopHeader: true,
        showMobileHeader: false,
        showMobileSubBackHeader: true,
        mobileSubBackHeaderTitle: t("exchange"),
      }}
    >
      <MypageLayout>
        {type === "exchange" ? (
          <ExchangeClient orderId={orderId} />
        ) : (
          await renderReturn(orderId, itemId)
        )}
      </MypageLayout>
    </WithHeaderLayout>
  )
}

async function renderReturn(orderId: string | undefined, itemId: string | undefined) {
  const t = await getTranslations("mypage.order.returnRequest")
  const backHref = orderId ? `/mypage/order/details?orderId=${orderId}` : "/mypage/order/list"
  const notice = (title: string) => (
    <div className="bg-white px-4 py-8 md:min-h-screen md:px-6">
      <PageTitle>{t("title")}</PageTitle>
      <p className="mt-6 font-medium text-foreground">{title}</p>
      <div className="mt-6">
        <LocalizedClientLink href={backHref}>
          <CustomButton variant="outline" color="secondary" size="md">
            {t("backToOrder")}
          </CustomButton>
        </LocalizedClientLink>
      </div>
    </div>
  )

  if (!orderId) return notice(t("unavailableTitle"))

  // 없는 주문과 남의 주문을 가르지 않는다 — 둘 다 같은 화면. 그 밖의 실패는 재시도 화면.
  let loaded: Awaited<ReturnType<typeof loadReturnData>>
  try {
    loaded = await loadReturnData(orderId)
  } catch (error) {
    // getOrder 의 리다이렉트(NEXT_REDIRECT) 등 Next 제어 흐름은 삼키지 않는다.
    unstable_rethrow(error)
    // 인증 실패는 error.tsx 의 토큰 복구로 보낸다. 그 밖의 실패만 재시도 화면.
    if (error instanceof ApiAuthError) throw error
    return notice(t("retryTitle"))
  }
  if (!loaded) return notice(t("unavailableTitle"))

  return (
    <ReturnRequestClient
      orderId={orderId}
      lines={loaded.lines}
      preselectItemId={itemId}
      pickupAddress={loaded.pickupAddress}
    />
  )
}

async function loadReturnData(
  orderId: string
): Promise<{ lines: ReturnFormLine[]; pickupAddress: string | null } | null> {
  const [order, returnable] = await Promise.all([getOrder(orderId), getReturnable(orderId)])
  if (!order || !returnable) return null
  const lines = buildReturnFormLines(
    (order.items ?? []).map((item) => ({
      id: item.id,
      title: item.title,
      variantTitle: item.variant_title ?? null,
      thumbnail: item.thumbnail ? getThumbnailUrl(item.thumbnail) : null,
      quantity: item.quantity,
    })),
    returnable,
    new Date()
  )
  const address = order.shipping_address ? buildAddressLine(order.shipping_address) : ""
  return { lines, pickupAddress: address || null }
}
