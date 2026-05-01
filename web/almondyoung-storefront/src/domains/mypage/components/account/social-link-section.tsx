"use client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Link2, Link2Off, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  linkSocialAccountAction,
  unlinkSocialAccountAction,
} from "../actions/social-link"
import type {
  SocialIdentitiesState,
  SocialProvider,
  SocialAccountDisplay,
} from "@/lib/types/ui/social-identity"

const PROVIDER_INFO: Record<
  SocialProvider,
  { label: string; bgColor: string; textColor: string; icon: string }
> = {
  kakao: {
    label: "카카오",
    bgColor: "bg-[#FEE500]",
    textColor: "text-[#191919]",
    icon: "K",
  },
  naver: {
    label: "네이버",
    bgColor: "bg-[#03C75A]",
    textColor: "text-white",
    icon: "N",
  },
}

const ALL_PROVIDERS: SocialProvider[] = ["kakao", "naver"]

function SocialProviderIcon({ provider }: { provider: SocialProvider }) {
  const info = PROVIDER_INFO[provider]
  return (
    <div
      className={`grid size-9 place-items-center rounded-full ${info.bgColor}`}
    >
      <span className={`text-sm font-bold ${info.textColor}`}>{info.icon}</span>
    </div>
  )
}

interface SocialLinkSectionProps {
  identitiesState: SocialIdentitiesState
}

export function SocialLinkSection({ identitiesState }: SocialLinkSectionProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [redirectingProvider, setRedirectingProvider] =
    useState<SocialProvider | null>(null)

  const socialAccounts: SocialAccountDisplay[] = ALL_PROVIDERS.map(
    (provider) => {
      const identity = identitiesState.identities.find(
        (i) => i.provider === provider
      )
      return {
        provider,
        linked: !!identity,
        linkedAt: identity?.linkedAt,
        email: identity?.email,
      }
    }
  )

  const linkedCount = identitiesState.identities.length
  const canUnlink = identitiesState.hasPassword || linkedCount > 1

  const handleLink = (provider: SocialProvider) => {
    // 현재 환경의 전체 URL (로컬: localhost:8000, 프로덕션: almondyoung-next.com)
    const redirectTo = window.location.origin + window.location.pathname

    startTransition(async () => {
      try {
        const result = await linkSocialAccountAction(provider, redirectTo)

        if (result.success && result.redirectUrl) {
          setRedirectingProvider(provider)
          window.location.href = result.redirectUrl
          return
        } else if (!result.success) {
          toast.error(result.error || "연동 시작 중 오류가 발생했습니다.")
        }
      } catch (error: unknown) {
        const err = error as Error & { digest?: string }
        if (err.digest === "UNAUTHORIZED" || err.message === "UNAUTHORIZED") {
          throw error
        }
        toast.error("연동 시작 중 오류가 발생했습니다.")
      }
    })
  }

  const handleUnlink = (provider: SocialProvider) => {
    const info = PROVIDER_INFO[provider]

    startTransition(async () => {
      try {
        const result = await unlinkSocialAccountAction(provider)

        if (result.success) {
          toast.success(`${info.label} 계정 연동이 해제되었습니다.`)
          router.refresh()
        } else {
          toast.error(result.error || "연동 해제 중 오류가 발생했습니다.")
        }
      } catch (error: unknown) {
        const err = error as Error & { digest?: string }
        if (err.digest === "UNAUTHORIZED" || err.message === "UNAUTHORIZED") {
          throw error
        }
        toast.error("연동 해제 중 오류가 발생했습니다.")
      }
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">소셜 계정 연동</CardTitle>
        <CardDescription>
          소셜 계정을 연동하면 간편하게 로그인할 수 있습니다.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {socialAccounts.map((account) => {
            const info = PROVIDER_INFO[account.provider]
            const isOnlyLoginMethod = !canUnlink && account.linked

            return (
              <div
                key={account.provider}
                className="flex items-center justify-between"
              >
                <div className="flex items-center gap-3">
                  <SocialProviderIcon provider={account.provider} />
                  <div className="flex flex-col">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{info.label}</span>
                      {account.linked ? (
                        <Badge
                          variant="outline"
                          className="border-green-200 bg-green-100 text-green-700"
                        >
                          연동됨
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="border-gray-200 bg-gray-100 text-gray-600"
                        >
                          미연동
                        </Badge>
                      )}
                    </div>
                    {account.linked && account.email && (
                      <span className="text-xs text-gray-500">
                        {account.email}
                      </span>
                    )}
                  </div>
                </div>

                {account.linked ? (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        disabled={isPending || isOnlyLoginMethod}
                        title={
                          isOnlyLoginMethod
                            ? "마지막 로그인 수단은 해제할 수 없습니다"
                            : undefined
                        }
                      >
                        {isPending ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Link2Off className="size-3.5" />
                        )}
                        연동 해제
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          {info.label} 연동 해제
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          {info.label} 계정 연동을 해제하시겠습니까? 해제 후에도
                          다시 연동할 수 있습니다.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>취소</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => handleUnlink(account.provider)}
                          disabled={isPending}
                        >
                          {isPending ? "처리 중..." : "연동 해제"}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => handleLink(account.provider)}
                    disabled={isPending || redirectingProvider !== null}
                  >
                    {redirectingProvider === account.provider ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Link2 className="size-3.5" />
                    )}
                    {redirectingProvider === account.provider
                      ? "연동 중..."
                      : "연동하기"}
                  </Button>
                )}
              </div>
            )
          })}
        </div>

        {!canUnlink && linkedCount > 0 && (
          <p className="mt-4 text-xs text-amber-600">
            비밀번호가 설정되어 있지 않고 연동된 소셜 계정이 1개뿐이면 해제할 수
            없습니다.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
