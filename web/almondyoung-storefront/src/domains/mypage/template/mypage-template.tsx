import { Suspense } from "react"
import { headers } from "next/headers"
import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
import { AdminAccessButton } from "@/components/admin/admin-access-button"
import { checkAdminScope } from "@lib/api/admin/inventory"
import { fetchMe } from "@lib/api/users/me"
import { getCurrentSubscription } from "@/lib/api/membership"
import { getPointBalance } from "@lib/api/wallet"
import type { UserDetail } from "@lib/types/ui/user"

import { UserProfileSection } from "../components/desktop/user-profile-section"
import { QuickMenuSection } from "../components/desktop/quick-menu-section"

import { MobileHeader } from "../components/mobile/mobile-header"
import { QuickLinks } from "../components/mobile/quick-links"
import { MenuList } from "../components/mobile/menu-list"
import PayLaterBanner from "../components/mobile/paylater-banner"
import { MENU_SECTIONS } from "../components/constants/mypage-constants"

import { ShippingItemsWrapper } from "./wrappers/shipping-items-wrapper"
import { PaymentInfoWrapper } from "./wrappers/payment-info-wrapper"
import { SavingsBannerWrapper } from "./wrappers/savings-banner-wrapper"
import { PointsBannerWrapper } from "./wrappers/points-banner-wrapper"
import { ShippingStatusWrapper } from "./wrappers/shipping-status-wrapper"

import {
  ShippingItemsSkeleton,
  PaymentInfoSkeleton,
  SavingsBannerSkeleton,
  PointsBannerSkeleton,
  ShippingStatusSkeleton,
} from "../components/shared/mypage-skeletons"

import type { MembershipData } from "../types/mypage-types"

export async function MyPageTemplate() {
  const [currentUser, { isAdmin }, subscription, pointBalance] =
    await Promise.all([
      fetchMe(),
      checkAdminScope(),
      getCurrentSubscription().catch(() => null),
      getPointBalance().catch(() => ({ balance: 0, withdrawable: 0 })),
    ])

  const headersList = await headers()
  const pathname = headersList.get("x-pathname") || ""
  const countryCode = pathname.split("/")[1] || "kr"

  const membershipData: MembershipData = {
    isMembershipPricing: subscription?.status === "ACTIVE",
    tier: subscription?.tier
      ? {
          code: subscription.tier.code,
          name: subscription.tier.name,
          priorityLevel: subscription.tier.priorityLevel,
        }
      : undefined,
  }

  const isPayLaterBannerEnabled = false

  return (
    <>
      {/* 모바일 콘텐츠 - lg 미만 */}
      <div className="block lg:hidden">
        <div className="mx-auto">
          <div className="bg-muted space-y-4 px-6 py-4">
            <MobileHeader
              userName={(currentUser as UserDetail)?.username}
              initialMembership={membershipData}
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
              initialMembership={membershipData}
              initialPointBalance={pointBalance.balance}
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
