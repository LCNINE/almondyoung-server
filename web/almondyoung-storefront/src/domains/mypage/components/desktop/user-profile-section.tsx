"use client"

import { CustomButton } from "@components/common/custom-buttons/custom-button"
import { Spinner } from "@components/common/spinner"
import { signout } from "@lib/api/medusa/customer"
import { useUser } from "contexts/user-context"
import { ChevronRight, Coins, Crown, User } from "lucide-react"
import { useRouter } from "next/navigation"
import { useTransition } from "react"

interface UserProfileSectionProps {
  userName: string
  userId: string
}

/**
 * 간결한 DOM 구조 + 의미있는 시맨틱 엘리먼트 사용
 * - 불필요한 div 중첩 제거
 * - 액션 버튼은 <nav><ul><li> 구조로 단순화
 * - 반복 클래스 최소화, 재사용 가능한 버튼 클래스 추출
 */
export function UserProfileSection({
  userName,
  userId,
}: UserProfileSectionProps) {
  const [isPending, startTransition] = useTransition()
  const router = useRouter()
  const { setUser } = useUser()

  const handleLogout = () => {
    startTransition(async () => {
      try {
        await signout()
        setUser(null)
        router.push("/")
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
          {/* 아바타 + 이름 (아이콘 크기 고정, 텍스트 줄바꿈 금지) */}
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

            {/* 멤버십 뱃지 (아이콘/텍스트 고정, 내부 줄바꿈 금지) */}
            <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-[#FF9500]">
              <Crown className="size-4" aria-hidden />
              <span className="text-base font-bold">멤버십 회원</span>
            </span>
          </div>
          {/* 액션 버튼들: 각 버튼 내부 줄바꿈 금지 */}
          <nav aria-label="프로필 액션" className="ml-0 md:ml-1">
            <ul className="flex items-center gap-2">
              <li>
                <CustomButton
                  className="text-gray-90 border-gray-90 hover:border-gray-90 whitespace-nowrap hover:bg-gray-100"
                  variant="outline"
                  size="sm"
                >
                  설정
                </CustomButton>
              </li>
              <li>
                <CustomButton
                  className="text-gray-90 border-gray-90 hover:border-gray-90 whitespace-nowrap hover:bg-gray-100"
                  variant="outline"
                  size="sm"
                >
                  맞춤형 관리
                </CustomButton>
              </li>
              <li>
                <CustomButton
                  className="text-gray-90 border-gray-90 hover:border-gray-90 whitespace-nowrap hover:bg-gray-100"
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

        {/* 우측: 적립금(클릭 가능) — 그룹 단위로만 줄바꿈, 내부는 nowrap */}
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
              <span className="text-lg font-bold text-black">2,000 원</span>
              <ChevronRight className="size-6 text-zinc-500" aria-hidden />
            </span>
          </div>
        </button>
      </div>
    </section>
  )
}
