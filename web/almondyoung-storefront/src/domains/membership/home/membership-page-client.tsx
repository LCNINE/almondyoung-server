"use client"

import { PageTitle } from "@/components/shared/page-title"
import MembershipStatusSection from "../components/status-selection"
import SubscriberSection from "./components/subscriber/subscriber-section"
import NonSubscriberSection from "./components/non-subscriber/non-subscriber-section"
import Image from "next/image"
interface MembershipPageClientProps {
  isMember: boolean
  membershipData: any | null
}

/**
 * 멤버십 관리 페이지 클라이언트 컴포넌트
 *
 * 서버에서 전달받은 멤버십 상태에 따라 다른 UI를 렌더링
 */
export default function MembershipPageClient({
  isMember,
  membershipData,
}: MembershipPageClientProps) {
  return (
    <div className="bg-white px-3 py-4 md:min-h-screen md:px-6">
      <PageTitle>멤버십 관리</PageTitle>

      {isMember ? <SubscriberSection /> : <NonSubscriberSection />}
    </div>
  )
}
