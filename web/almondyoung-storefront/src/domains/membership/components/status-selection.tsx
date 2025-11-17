import React from "react"
import Image from "next/image"

interface MembershipStatusSectionProps {
  isMember: boolean
}

/**
 * 멤버십 상태 섹션
 *
 * 멤버십 로고와 함께 가입자/비가입자에 따라 다른 내용을 표시
 */
export default function MembershipStatusSection({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col items-center gap-8 self-stretch rounded-xl border-gray-200 py-10 md:border md:px-6">
      {/* 공통 UI: 로고 */}
      <header className="flex flex-col items-center gap-3 text-center">
        <figure className="flex flex-col items-center gap-2">
          <Image
            src="/icons/membership-logo.svg"
            alt="멤버십 로고"
            width={64}
            height={64}
          />
        </figure>
      </header>
      {children}
    </section>
  )
}
