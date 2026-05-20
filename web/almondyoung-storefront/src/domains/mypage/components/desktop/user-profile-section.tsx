"use client"

import LocalizedClientLink from "@/components/shared/localized-client-link"
import { Spinner } from "@/components/shared/spinner"
import { Button } from "@/components/ui/button"
import { useUser } from "@/contexts/user-context"
import { signout } from "@lib/api/users/signout"
import { ChevronRight, Coins, Crown, User } from "lucide-react"
import { useTranslations } from "next-intl"
import { useTransition } from "react"

interface UserProfileSectionProps {
  userName: string
  initialPointBalance: number
  isMembership: boolean
}

export function UserProfileSection({
  userName,
  initialPointBalance,
  isMembership,
}: UserProfileSectionProps) {
  const [isPending, startTransition] = useTransition()
  const { setUser } = useUser()
  const t = useTranslations("mypage.profile")

  const handleLogout = () => {
    startTransition(async () => {
      setUser(null)
      await signout()
    })
  }

  return (
    <section aria-label={t("ariaLabel")} className="pb-6">
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
                <span className="text-lg text-zinc-600">{t("honorific")}</span>
              </strong>
            </div>

            {/* 멤버십 뱃지 or 가입 유도 */}
            {isMembership ? (
              <LocalizedClientLink href="/mypage/membership">
                <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-[#FF9500] transition-opacity hover:opacity-80">
                  <Crown className="size-4" aria-hidden />
                  <span className="text-base font-bold">
                    {t("membershipMember")}
                  </span>
                </span>
              </LocalizedClientLink>
            ) : (
              <LocalizedClientLink href="/mypage/membership/subscribe/payment">
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-3 py-1 whitespace-nowrap text-amber-700 transition-colors hover:bg-amber-200">
                  <Crown className="size-4" aria-hidden />
                  <span className="text-sm font-bold">
                    {t("membershipJoin")}
                  </span>
                </span>
              </LocalizedClientLink>
            )}
          </div>

          {/* 액션 버튼들 */}
          <nav aria-label={t("profileEdit")} className="ml-0 md:ml-1">
            <ul className="flex items-center gap-2">
              <li>
                <LocalizedClientLink href="/mypage/account/profile">
                  <Button className="cursor-pointer" variant="outline">
                    {t("profileEdit")}
                  </Button>
                </LocalizedClientLink>
              </li>
              <li>
                <Button
                  className="cursor-pointer"
                  variant="outline"
                  onClick={handleLogout}
                >
                  {isPending ? <Spinner size="sm" color="gray" /> : t("logout")}
                </Button>
              </li>
            </ul>
          </nav>
        </div>

        {/* 우측: 적립금 */}
        <LocalizedClientLink href="/mypage/point">
          <button
            type="button"
            aria-label={t("pointAriaLabel")}
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
                  {t("pointTitle")}
                </span>
              </span>

              <span className="inline-flex items-center gap-2.5 whitespace-nowrap">
                <span className="text-lg font-bold text-black">
                  {initialPointBalance.toLocaleString()} {t("won")}
                </span>
                <ChevronRight className="size-6 text-zinc-500" aria-hidden />
              </span>
            </div>
          </button>
        </LocalizedClientLink>
      </div>
    </section>
  )
}
