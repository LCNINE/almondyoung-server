"use client"

import { CustomButton } from "@/components/shared/custom-buttons/custom-button"
import { Spinner } from "@/components/shared/spinner"
import { useMembership } from "@/contexts/membership-context"
import { useUser } from "@/contexts/user-context"
import { signout } from "@lib/api/users/signout"
import { ChevronRight, Coins, Crown, User } from "lucide-react"
import { useRouter } from "next/navigation"
import { useTransition } from "react"
import Link from "next/link"

interface UserProfileSectionProps {
  userName: string
  initialPointBalance: number
}

export function UserProfileSection({
  userName,
  initialPointBalance,
}: UserProfileSectionProps) {
  const [isPending, startTransition] = useTransition()
  const router = useRouter()
  const { setUser } = useUser()
  const { isMembershipPricing, tier } = useMembership()

  const handleLogout = () => {
    startTransition(async () => {
      try {
        await signout()
        setUser(null)
        router.replace("/")
      } catch (error) {
        console.error("로그아웃 중 오류가 발생했습니다:", error)
      }
    })
  }

  return (
    <section aria-label="사용자 프로필" className="pb-6">
      <div className="flex flex-wrap items-center justify-between gap-4 sm:gap-6">
        {/* 좌측: 아바타 / 이름 / 멤버십 / 액션 */}
        <div className="flex flex-1 items-center gap-4 md:gap-5">
          {/* 아바타 + 이름 */}
          <div className="flex items-center gap-3 sm:gap-4">
            <div
              className="grid size-10 place-items-center rounded-full bg-zinc-200"
              aria-hidden
            >
              <User className="size-6 text-white" />
            </div>
            <div className="flex items-center gap-1">
              <strong className="flex items-center gap-1 font-normal whitespace-nowrap">
                <span className="text-lg font-bold text-black">{userName}</span>
                <span className="text-lg text-zinc-600">님</span>
              </strong>
            </div>

            {/* 멤버십 뱃지 or 가입 유도 */}
            {isMembershipPricing ? (
              <Link href="/kr/mypage/membership">
                <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-[#FF9500] transition-opacity hover:opacity-80">
                  <Crown className="size-4" aria-hidden />
                  <span className="text-base font-bold">
                    {tier?.name ?? "멤버십"} 회원
                  </span>
                </span>
              </Link>
            ) : (
              <Link href="/kr/mypage/membership/subscribe/payment">
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-3 py-1 whitespace-nowrap text-amber-700 transition-colors hover:bg-amber-200">
                  <Crown className="size-4" aria-hidden />
                  <span className="text-sm font-bold">멤버십 가입하기</span>
                </span>
              </Link>
            )}
          </div>

          {/* 액션 버튼들 */}
          <nav aria-label="프로필 액션" className="ml-0 md:ml-1">
            <ul className="flex items-center gap-2">
              <li>
                <Link href="/kr/mypage/account/profile">
                  <CustomButton
                    className="text-gray-90 border-gray-90 hover:border-gray-90 cursor-pointer whitespace-nowrap hover:bg-gray-100"
                    variant="outline"
                    size="sm"
                  >
                    프로필 수정
                  </CustomButton>
                </Link>
              </li>
              <li>
                <CustomButton
                  className="text-gray-90 border-gray-90 hover:border-gray-90 cursor-pointer whitespace-nowrap hover:bg-gray-100"
                  variant="outline"
                  size="sm"
                  onClick={handleLogout}
                >
                  {isPending ? <Spinner size="sm" color="gray" /> : "로그아웃"}
                </CustomButton>
              </li>
            </ul>
          </nav>
        </div>

        {/* 우측: 적립금 */}
        <Link href="/kr/mypage/point">
          <button
            type="button"
            aria-label="아몬드영 적립금 보기"
            className="mt-2 flex w-full items-center justify-between gap-3 border-t pt-3 transition-opacity hover:opacity-80 sm:mt-0 sm:w-auto sm:justify-end sm:gap-4 sm:border-0 sm:pt-0"
          >
            <div className="flex items-center gap-2.5">
              <span className="inline-flex items-center gap-2.5 whitespace-nowrap">
                <span
                  className="grid size-7 shrink-0 place-items-center rounded-full bg-[#FF9500]"
                  aria-hidden
                >
                  <Coins className="size-4 text-white" />
                </span>
                <span className="text-lg font-bold text-black">
                  아몬드영 적립금
                </span>
              </span>

              <span className="inline-flex items-center gap-2.5 whitespace-nowrap">
                <span className="text-lg font-bold text-black">
                  {initialPointBalance.toLocaleString()} 원
                </span>
                <ChevronRight className="size-6 text-zinc-500" aria-hidden />
              </span>
            </div>
          </button>
        </Link>
      </div>
    </section>
  )
}
