import LocalizedClientLink from "@/components/shared/localized-client-link"
import { getTranslations } from "next-intl/server"

interface UnavailableItemsNoticeProps {
  /** 판매 중단/미게시로 결제를 막은 상품명 목록 */
  unavailableNames: string[]
}

/**
 * 카트에 draft/미게시/삭제된 상품이 남아 체크아웃을 진행할 수 없을 때 보여주는 차단 화면.
 * 고객이 담은 상품을 임의로 삭제하지 않고, 어떤 상품이 문제인지 알린 뒤
 * 장바구니에서 직접 제거하도록 유도한다.
 */
export default async function UnavailableItemsNotice({
  unavailableNames,
}: UnavailableItemsNoticeProps) {
  const t = await getTranslations("checkout.process.unavailableItems")
  const names = unavailableNames.filter(Boolean)

  return (
    <main className="flex min-h-[100dvh] flex-col items-center justify-center px-6 py-16">
      <div className="flex w-full max-w-sm flex-col items-center">
        <h1 className="text-center text-[22px] leading-snug font-semibold tracking-tight text-gray-900 break-keep sm:text-[26px]">
          {t("title")}
        </h1>
        <p className="mt-3 text-center text-[15px] leading-relaxed text-gray-500 break-keep sm:text-base">
          {t("description")}
        </p>

        {names.length > 0 && (
          <ul className="mt-7 w-full space-y-2">
            {names.map((name, index) => (
              <li
                key={index}
                className="rounded-xl bg-gray-50 px-4 py-3 text-center text-sm font-medium text-gray-800 break-keep"
              >
                {name}
              </li>
            ))}
          </ul>
        )}

        <LocalizedClientLink
          href="/cart"
          className="mt-8 w-full rounded-xl bg-[#F29219] px-10 py-4 text-center text-[15px] font-semibold text-white transition-colors hover:bg-[#E08510] sm:text-base"
        >
          {t("goToCart")}
        </LocalizedClientLink>
      </div>
    </main>
  )
}
