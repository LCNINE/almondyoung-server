import { Settings, Crown } from "lucide-react"
import Link from "next/link"
import type { MembershipData } from "../../types/mypage-types"

interface MobileHeaderProps {
  userName: string
  initialMembership: MembershipData
}

export function MobileHeader({ userName, initialMembership }: MobileHeaderProps) {
  const { isMembershipPricing, tier } = initialMembership
  const isMember = isMembershipPricing
  const tierName = tier?.name ?? "멤버십"

  return (
    <header className="flex items-center justify-between">
      <div className="flex w-full items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold">{userName} 님</h1>
          {isMember ? (
            <Link href="/kr/mypage/membership">
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-1 text-xs font-bold text-amber-700">
                <Crown className="h-3 w-3" />
                {tierName}
              </span>
            </Link>
          ) : (
            <Link href="/kr/mypage/membership/subscribe">
              <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-1 text-xs font-bold text-gray-600">
                <Crown className="h-3 w-3" />
                가입하기
              </span>
            </Link>
          )}
        </div>
        <Link href="/kr/mypage/account/profile">
          <button aria-label="설정">
            <Settings className="h-6 w-6" />
          </button>
        </Link>
      </div>
    </header>
  )
}
