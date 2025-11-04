"use client"
import { useState } from "react"
import { MembershipTag } from "@components/products/atomics/membership-tag"
import { ChevronRight } from "lucide-react"
import Image from "next/image"
import { PageTitle } from "@components/common/page-title"
import { IconTextButton } from "../../../../../domains/membership/components/icon-button"
import { MembershipCancelModal } from "../../../../../domains/membership/components/modal"
import MembershipStatusSection from "../../../../../domains/membership/components/status-selection"
import { useRouter } from "next/navigation"
import { WithHeaderLayout } from "@components/layout"
import MypageLayout from "@components/layout/mypage-layout"
import CommonButton from "@components/common/custom-buttons/common-button"
import MembershipRequestBanner from "domains/membership/home/components/membership-request-banner"
import MembershipBenefitsCard from "domains/membership/home/components/membership-benefit-card"
import MembershipBenefitsHorizontal from "domains/membership/home/components/membership-benefit"
import MembershipPlanCard from "domains/membership/home/components/membership-benefit-card"

// 멤버십 관리페이지
export default function MembershipPage() {
  const [open, setOpen] = useState(false)
  const isMember = false // (상태값)
  const router = useRouter()

  return (
    <WithHeaderLayout
      config={{
        showDesktopHeader: true,
        showMobileHeader: false,
        showMobileSubBackHeader: true,
        mobileSubBackHeaderTitle: "아몬드영 멤버십",
      }}
    >
      <MypageLayout>
        <div className="min-h-screen bg-white py-4 md:px-6">
          <PageTitle>멤버십 관리</PageTitle>
          <MembershipRequestBanner />

          <MembershipStatusSection />
          <section className="mb-[36px]">
            <h3 className="my-4 hidden text-lg font-semibold text-black md:block">
              멤버십 혜택
            </h3>

            <MembershipPlanCard />
          </section>
          {/* <MembershipBenefitsHorizontal /> */}
          {isMember ? (
            <>
              <IconTextButton
                label="멤버십 해지하기"
                size="full"
                onClick={() => setOpen(true)}
              />
              <MembershipCancelModal open={open} setOpen={setOpen} />
            </>
          ) : (
            <>
              <CommonButton
                variant="orange"
                appearance="filled"
                size="lg"
                height={44}
                fullWidth={true}
                onClick={() =>
                  router.push("/kr/mypage/membership/subscribe/payment")
                }
              >
                아몬드영 멤버십 신청하기
              </CommonButton>
            </>
          )}
        </div>
      </MypageLayout>
    </WithHeaderLayout>
  )
}
