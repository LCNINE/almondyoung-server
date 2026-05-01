"use client"

import { Crown, Settings } from "lucide-react"
import Link from "next/link"

interface MobileHeaderProps {
  userName: string
  isMembership: boolean
}

export function MobileHeader({ userName, isMembership }: MobileHeaderProps) {
  return (
    <header className="flex items-center justify-between">
      <div className="flex w-full items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold">{userName} 님</h1>
          {isMembership ? (
            <Link href="/kr/mypage/membership">
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-1 text-xs font-bold text-amber-700">
                <Crown className="h-3 w-3" />
                멤버십 회원
              </span>
            </Link>
          ) : (
            <Link href="/kr/mypage/membership/subscribe/payment">
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
