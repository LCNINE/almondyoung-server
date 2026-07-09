import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
import { AdminAccessButton } from "@/components/admin/admin-access-button"
import { checkAdminScope } from "@lib/api/admin/inventory"
import { fetchMe } from "@lib/api/users/me"
import { getPointBalance } from "@lib/api/wallet"
import type { UserDetail } from "@lib/types/ui/user"
import { Suspense } from "react"

import { OrderListWrapper } from "./wrappers/order-list-wrapper"
import { ShippingStatusWrapper } from "./wrappers/shipping-status-wrapper"

import { retrieveCart } from "@/lib/api/medusa/cart"
import { retrieveCustomer } from "@/lib/api/medusa/customer"
import type { CustomerGroupRef } from "@/lib/utils/membership-group"
import { isMembershipGroup } from "@/lib/utils/membership-group"
import { UserProfileSection } from "../../components/desktop/user-profile-section"
import { FrequentMenu } from "../../components/mobile/frequent-menu"
import { MobileHeader } from "../../components/mobile/mobile-header"
import { QuickLinks } from "../../components/mobile/quick-links"
import {
  MypageHomeOrderListSkeleton,
  ShippingStatusSkeleton,
} from "../../components/shared/mypage-skeletons"
import { withMypageTimeout } from "./wrappers/mypage-timeout"

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

  const [customer, cart] = await Promise.all([
    withMypageTimeout(retrieveCustomer(), null),
    withMypageTimeout(retrieveCart(undefined, undefined, "no-store"), null),
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
      <div className="bg-muted block lg:hidden">
        {/* 프로필 영역 */}
        <div className="bg-primary/90 space-y-3 px-6 pt-4 pb-5">
          <MobileHeader
            userName={(currentUser as UserDetail)?.username}
            isMembership={isMembershipPricing}
            pointAvailable={pointBalance.available}
          />

          {/* 관리자 버튼 */}
          {isAdmin && (
            <AdminAccessButton countryCode={countryCode} className="w-full" />
          )}
        </div>

        {/* 퀵메뉴 */}
        <div className="bg-white px-6 py-4">
          <QuickLinks />
        </div>

        {/* 주문 내역 */}
        <div className="mt-2 bg-white px-6 py-5">
          <Suspense fallback={<ShippingStatusSkeleton />}>
            <ShippingStatusWrapper />
          </Suspense>
        </div>

        {/* 자주 쓰는 메뉴 */}
        <div className="mt-2 bg-white px-6 py-5">
          <FrequentMenu />
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

            <div className="mt-6">
              <Suspense fallback={<MypageHomeOrderListSkeleton />}>
                <OrderListWrapper />
              </Suspense>
            </div>
          </div>
        </MypageLayout>
      </div>
    </>
  )
}
