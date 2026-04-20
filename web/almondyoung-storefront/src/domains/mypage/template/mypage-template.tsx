import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
import { AdminAccessButton } from "@/components/admin/admin-access-button"
import { checkAdminScope } from "@lib/api/admin/inventory"
import { fetchMe } from "@lib/api/users/me"
import { getPointBalance } from "@lib/api/wallet"
import type { UserDetail } from "@lib/types/ui/user"
import { Suspense } from "react"

import { QuickMenuSection } from "../components/desktop/quick-menu-section"
import { UserProfileSection } from "../components/desktop/user-profile-section"

import { MENU_SECTIONS } from "../components/constants/mypage-constants"
import { MenuList } from "../components/mobile/menu-list"
import { MobileHeader } from "../components/mobile/mobile-header"
import PayLaterBanner from "../components/mobile/paylater-banner"
import { QuickLinks } from "../components/mobile/quick-links"

import { PaymentInfoWrapper } from "./wrappers/payment-info-wrapper"
import { PointsBannerWrapper } from "./wrappers/points-banner-wrapper"
import { SavingsBannerWrapper } from "./wrappers/savings-banner-wrapper"
import { ShippingItemsWrapper } from "./wrappers/shipping-items-wrapper"
import { ShippingStatusWrapper } from "./wrappers/shipping-status-wrapper"

import { retrieveCart } from "@/lib/api/medusa/cart"
import { retrieveCustomer } from "@/lib/api/medusa/customer"
import type { CustomerGroupRef } from "@/lib/utils/membership-group"
import { isMembershipGroup } from "@/lib/utils/membership-group"
import {
  PaymentInfoSkeleton,
  PointsBannerSkeleton,
  SavingsBannerSkeleton,
  ShippingItemsSkeleton,
  ShippingStatusSkeleton,
} from "../components/shared/mypage-skeletons"

export async function MyPageTemplate({ countryCode }: { countryCode: string }) {
  const [currentUser, { isAdmin }, pointBalance] = await Promise.all([
    fetchMe(),
    checkAdminScope(),
    getPointBalance().catch(() => ({
      available: 0,
      confirmed: 0,
      reserved: 0,
    })),
  ])

  const isPayLaterBannerEnabled = false // bnpl 기능 미연결로 임시 비활성화

  const [customer, cart] = await Promise.all([
    retrieveCustomer().catch(() => null),
    retrieveCart(undefined, undefined, "no-store").catch(() => null),
  ])
  const cartWithCustomer = cart as
    | (typeof cart & { customer?: { groups?: CustomerGroupRef[] } })
    | null
  const isMembershipPricing =
    isMembershipGroup(cartWithCustomer?.customer?.groups) ||
    isMembershipGroup(customer?.groups)

  return (
    <>
      {/* 모바일 콘텐츠 - lg 미만 */}
      <div className="block lg:hidden">
        <div className="mx-auto">
          <div className="bg-muted space-y-4 px-6 py-4">
            <MobileHeader
              userName={(currentUser as UserDetail)?.username}
              isMembership={isMembershipPricing}
            />

            {/* 관리자 버튼 */}
            {isAdmin && (
              <div className="pb-2">
                <AdminAccessButton
                  countryCode={countryCode}
                  className="w-full"
                />
              </div>
            )}

            <Suspense fallback={<SavingsBannerSkeleton />}>
              <SavingsBannerWrapper />
            </Suspense>

            <Suspense fallback={<PointsBannerSkeleton />}>
              <PointsBannerWrapper />
            </Suspense>

            <QuickLinks />

            <Suspense fallback={<ShippingStatusSkeleton />}>
              <ShippingStatusWrapper />
            </Suspense>
          </div>
          {isPayLaterBannerEnabled && <PayLaterBanner />}
          <MenuList sections={MENU_SECTIONS} />
        </div>
      </div>

      {/* 데스크탑 콘텐츠 - lg 이상 */}
      <div className="hidden lg:block">
        <MypageLayout>
          <div>
            <UserProfileSection
              userName={(currentUser as UserDetail)?.username}
              isMembership={isMembershipPricing}
              initialPointBalance={pointBalance.available}
            />

            {/* 관리자 버튼 */}
            {isAdmin && (
              <div className="mb-4">
                <AdminAccessButton countryCode={countryCode} />
              </div>
            )}

            <QuickMenuSection />

            <Suspense fallback={<ShippingItemsSkeleton />}>
              <ShippingItemsWrapper />
            </Suspense>

            <Suspense fallback={<PaymentInfoSkeleton />}>
              <PaymentInfoWrapper />
            </Suspense>
          </div>
        </MypageLayout>
      </div>
    </>
  )
}
