"use client"

import { Separator } from "@/components/ui/separator"
import type { UserDetail } from "@lib/types/ui/user"
import type { SocialIdentitiesState } from "@/lib/types/ui/social-identity"
import { AccountInfoCard } from "./account-info-card"
import { AddressBookSection } from "./address-book-section"
import { InterestCategoriesSection } from "./interest-categories-section"

interface ProfileEditProps {
  userData: UserDetail
  identitiesState: SocialIdentitiesState
}

export function ProfileEdit({ userData }: ProfileEditProps) {
  return (
    <div className="space-y-6 py-2 md:py-4">
      {/* 계정 정보 (비밀번호/이메일/휴대폰/이름/닉네임/생년월일/아이디) */}
      <AccountInfoCard
        email={userData.email || ""}
        isEmailVerified={userData.isEmailVerified ?? false}
        phoneNumber={userData.profile?.phoneNumber ?? null}
        username={userData.username || ""}
        nickname={userData.nickname || ""}
        birthDate={userData.profile?.birthDate ?? null}
        loginId={userData.loginId || ""}
      />

      {/* 관심 카테고리 */}
      <InterestCategoriesSection
        initialKeys={userData.profile?.interestCategoryKeys ?? []}
      />

      <Separator />

      {/* 배송지 관리 */}
      <AddressBookSection />
    </div>
  )
}
