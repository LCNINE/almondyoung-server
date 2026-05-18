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
import { useTranslations } from "next-intl"
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
  { labelKey: "providerKakao" | "providerNaver"; bgColor: string; textColor: string; icon: string }
> = {
  kakao: {
    labelKey: "providerKakao",
    bgColor: "bg-[#FEE500]",
    textColor: "text-[#191919]",
    icon: "K",
  },
  naver: {
    labelKey: "providerNaver",
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
  const t = useTranslations("mypage.socialLink")
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
          toast.error(result.error || t("linkStartError"))
        }
      } catch (error: unknown) {
        const err = error as Error & { digest?: string }
        if (err.digest === "UNAUTHORIZED" || err.message === "UNAUTHORIZED") {
          throw error
        }
        toast.error(t("linkStartError"))
      }
    })
  }

  const handleUnlink = (provider: SocialProvider) => {
    const info = PROVIDER_INFO[provider]
    const providerLabel = t(info.labelKey)

    startTransition(async () => {
      try {
        const result = await unlinkSocialAccountAction(provider)

        if (result.success) {
          toast.success(t("unlinkSuccess", { provider: providerLabel }))
          router.refresh()
        } else {
          toast.error(result.error || t("unlinkError"))
        }
      } catch (error: unknown) {
        const err = error as Error & { digest?: string }
        if (err.digest === "UNAUTHORIZED" || err.message === "UNAUTHORIZED") {
          throw error
        }
        toast.error(t("unlinkError"))
      }
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{t("title")}</CardTitle>
        <CardDescription>
          {t("description")}
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
                      <span className="text-sm font-medium">{t(info.labelKey)}</span>
                      {account.linked ? (
                        <Badge
                          variant="outline"
                          className="border-green-200 bg-green-100 text-green-700"
                        >
                          {t("linked")}
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="border-gray-200 bg-gray-100 text-gray-600"
                        >
                          {t("notLinked")}
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
                            ? t("lastLoginMethodTitle")
                            : undefined
                        }
                      >
                        {isPending ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Link2Off className="size-3.5" />
                        )}
                        {t("unlink")}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          {t("unlinkConfirmTitle", { provider: t(info.labelKey) })}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          {t("unlinkConfirmDescription", { provider: t(info.labelKey) })}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => handleUnlink(account.provider)}
                          disabled={isPending}
                        >
                          {isPending ? t("processing") : t("unlink")}
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
                      ? t("linking")
                      : t("link")}
                  </Button>
                )}
              </div>
            )
          })}
        </div>

        {!canUnlink && linkedCount > 0 && (
          <p className="mt-4 text-xs text-amber-600">
            {t("warningNoUnlink")}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
