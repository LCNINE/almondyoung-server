"use client"

import { MessageCircle, Phone } from "lucide-react"
import { useTranslations } from "next-intl"
import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { formatPhone } from "@/domains/shop-trade/phone"
import { getShopListingContact } from "@/lib/api/ugc/shop-listings"
import { siteConfig } from "@/lib/config/site"
import type { ShopListingContactDto } from "@/lib/types/dto/shop-listing"
import { getPathWithoutCountry } from "@/lib/utils/get-path-without-country"

/**
 * 상세 페이지는 뷰어 구분 없이 캐시된다(ADR-0038). 그래서 버튼은 로그인 여부와 무관하게 같은 모양이고,
 * 누른 뒤에야 서버 액션이 로그인 여부를 가른다. 이 화면의 Primary CTA 는 이 버튼 하나다(DESIGN.md §1).
 */
export function ContactReveal({
  slug,
  countryCode,
}: {
  slug: string
  countryCode: string
}) {
  const t = useTranslations("shopTrade.contact")
  const [pending, setPending] = useState(false)
  const [contact, setContact] = useState<ShopListingContactDto | null>(null)

  const reveal = async () => {
    setPending(true)
    const result = await getShopListingContact(slug)
    setPending(false)

    if (result.ok) {
      setContact(result.data)
      return
    }
    if (result.status === 401) {
      const path = getPathWithoutCountry(countryCode)
      window.location.href = `/${countryCode}${siteConfig.auth.loginUrl}?redirect_to=${encodeURIComponent(path)}`
      return
    }
    toast.error(t("loadFail"))
  }

  if (!contact) {
    return (
      <Button
        onClick={() => void reveal()}
        disabled={pending}
        className="mt-6 h-[52px] w-full rounded-xl text-base font-bold"
      >
        {t("show")}
      </Button>
    )
  }

  if (!contact.contactPhone && !contact.kakaoOpenChatUrl) {
    return (
      <p className="bg-muted text-muted-foreground mt-6 rounded-xl p-4 text-center text-sm">
        {t("none")}
      </p>
    )
  }

  return (
    <div className="border-border mt-6 grid gap-2 rounded-xl border p-4">
      {contact.contactPhone && (
        <a
          href={`tel:${contact.contactPhone}`}
          className="text-foreground flex items-center gap-2 text-base font-bold"
        >
          <Phone className="h-4 w-4" />
          {formatPhone(contact.contactPhone)}
          <span className="text-muted-foreground text-sm font-normal">
            {t("call")}
          </span>
        </a>
      )}
      {contact.kakaoOpenChatUrl && (
        <a
          href={contact.kakaoOpenChatUrl}
          target="_blank"
          rel="nofollow noopener noreferrer"
          className="text-foreground flex items-center gap-2 text-sm font-medium"
        >
          <MessageCircle className="h-4 w-4" />
          {t("openChat")}
        </a>
      )}
    </div>
  )
}
