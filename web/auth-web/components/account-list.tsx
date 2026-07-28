"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { ChevronRight, Trash2, UserRound } from "lucide-react"

import { removeAccountAction, selectAccountAction } from "@/app/actions"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { StoredAccount } from "@/lib/account-store"
import { cn } from "@/lib/utils"

type Props = {
  accounts: StoredAccount[]
  activeUserId: string | null
  redirectTo: string
  editing: boolean
}

export function AccountList({
  accounts,
  activeUserId,
  redirectTo,
  editing,
}: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  // 빈 상태는 목록 영역 전체를 채우되 배경을 두지 않는다 — 큰 회색 면을 깔면
  // 아무것도 없는 자리가 화면에서 제일 무거운 요소가 된다.
  if (accounts.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-1 py-10 text-center">
        <span className="mb-2 flex size-12 items-center justify-center rounded-full bg-muted">
          <UserRound className="size-6 text-muted-foreground" aria-hidden />
        </span>
        <p className="text-base font-bold text-foreground">
          저장된 계정이 없어요
        </p>
        <p className="text-sm text-muted-foreground">
          로그인하면 다음부터 여기에서 바로 선택할 수 있어요.
        </p>
      </div>
    )
  }

  const handleSelect = (userId: string) => {
    startTransition(async () => {
      const res = await selectAccountAction(userId, redirectTo)
      if (res && !res.ok) alert(res.error)
    })
  }

  const handleRemove = (userId: string) => {
    startTransition(async () => {
      await removeAccountAction(userId)
      router.refresh()
    })
  }

  return (
    <ul className="flex flex-col gap-2">
      {accounts.map((acct) => {
        const isActive = acct.userId === activeUserId
        const expired = !acct.hasValidRefreshToken
        const displayName = acct.nickname || acct.username
        const info = (
          <>
            <span
              aria-hidden
              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary text-base font-bold text-muted-foreground"
            >
              {displayName.charAt(0)}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <div className="flex items-center gap-2">
                <span className="truncate text-base font-medium text-foreground">
                  {displayName}
                </span>
                {isActive && (
                  <Badge
                    variant="secondary"
                    className="bg-[#fff2ec] text-primary"
                  >
                    현재 로그인
                  </Badge>
                )}
                {expired && !isActive && (
                  <Badge variant="outline" className="text-muted-foreground">
                    재로그인 필요
                  </Badge>
                )}
              </div>
              <span className="truncate text-[13px] leading-[18px] text-muted-foreground">
                {acct.email}
              </span>
            </div>
          </>
        )

        // 편집 모드는 의도적 삭제 컨텍스트 — 카드 통클릭 대신 우측 trash 아이콘만 타겟.
        if (editing) {
          return (
            <li
              key={acct.userId}
              className="flex items-center gap-3 rounded-lg border border-border bg-background p-4"
            >
              {info}
              <Button
                variant="ghost"
                size="icon"
                disabled={pending}
                onClick={() => handleRemove(acct.userId)}
                aria-label="삭제"
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          )
        }

        const actionLabel = isActive
          ? "현재 계정으로 계속"
          : expired
            ? "재로그인"
            : "이 계정으로 로그인"
        return (
          <li key={acct.userId}>
            <button
              type="button"
              disabled={pending}
              onClick={() => handleSelect(acct.userId)}
              aria-label={actionLabel}
              className="flex w-full cursor-pointer items-center gap-3 rounded-lg border border-border bg-background p-4 text-left shadow-[0_2px_10px_rgba(0,0,0,0.1)] transition-colors duration-150 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
            >
              {info}
              <ChevronRight
                className="size-5 shrink-0 text-muted-foreground"
                aria-hidden
              />
            </button>
          </li>
        )
      })}
    </ul>
  )
}
