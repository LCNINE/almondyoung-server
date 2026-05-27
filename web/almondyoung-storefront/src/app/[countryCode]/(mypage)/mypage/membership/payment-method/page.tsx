"use client"

import {
  getBillingAgreements,
  getBillingMethods,
  updateBillingAgreementMethod,
} from "@lib/api/wallet"
import { getCurrentSubscription, subscribeWithBillingMethod } from "@lib/api/membership"
import type { BillingAgreementDto, BillingMethodDto } from "@lib/types/dto/wallet"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { MembershipPaymentMethodSkeleton } from "@/components/skeletons/page-skeletons"
import { providerLabel } from "@lib/utils/billing-provider"
import { formatDate } from "@lib/utils/format-date"

const IconChevronLeft = () => (
  <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    <path
      fillRule="evenodd"
      d="M12.79 5.23a.75.75 0 010 1.06L9.06 10l3.73 3.71a.75.75 0 11-1.06 1.06l-4.25-4.25a.75.75 0 010-1.06l4.25-4.25a.75.75 0 011.06 0z"
      clipRule="evenodd"
    />
  </svg>
)

const IconCheckCircle = () => (
  <svg className="h-4 w-4 text-green-500" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    <path
      fillRule="evenodd"
      d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
      clipRule="evenodd"
    />
  </svg>
)



export default function MembershipPaymentMethodPage() {
  const router = useRouter()
  const params = useParams()
  const countryCode = typeof params.countryCode === "string" ? params.countryCode : "kr"
  const searchParams = useSearchParams()
  const t = useTranslations("mypage.membershipPaymentMethod")

  const planId = searchParams.get("planId")
  const redirect = searchParams.get("redirect")
  const isSubscribeFlow = redirect === "subscribe" && !!planId
  const autoSubscribeOnLoad = useRef(isSubscribeFlow && searchParams.get("cardChanged") === "1")

  const [isLoading, setIsLoading] = useState(true)
  const [agreement, setAgreement] = useState<BillingAgreementDto | null>(null)
  const [allMethods, setAllMethods] = useState<BillingMethodDto[]>([])
  const [nextBillingDate, setNextBillingDate] = useState<string | null>(null)
  const [isChanging, setIsChanging] = useState<string | null>(null)

  const currentMethod = allMethods.find((m) => m.id === agreement?.billingMethodId) ?? null
  const otherMethods = allMethods.filter(
    (m) => m.status === "ACTIVE" && m.id !== agreement?.billingMethodId,
  )

  useEffect(() => {
    if (searchParams.get("cardChanged") === "1") {
      if (!isSubscribeFlow) {
        toast.success(t("changeSuccess"))
      }
      const url = new URL(window.location.href)
      url.searchParams.delete("cardChanged")
      window.history.replaceState(null, "", url.toString())
    }
  }, [searchParams, isSubscribeFlow, t])

  useEffect(() => {
    async function load() {
      try {
        setIsLoading(true)
        const [agreements, methods, subscription] = await Promise.all([
          getBillingAgreements(),
          getBillingMethods(),
          isSubscribeFlow ? Promise.resolve(null) : getCurrentSubscription().catch(() => null),
        ])

        const membershipAgreement =
          agreements.find(
            (a) => a.subscriberType === "MEMBERSHIP" && a.status === "ACTIVE",
          ) ?? null

        setAgreement(membershipAgreement)
        setAllMethods(methods.filter((m) => m.status === "ACTIVE"))
        setNextBillingDate(subscription?.nextBillingDate ?? null)
      } catch {
        toast.error(t("loadError"))
      } finally {
        setIsLoading(false)
      }
    }

    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleChangeMethod = async (billingMethodId: string) => {
    if (!agreement || isChanging) return

    try {
      setIsChanging(billingMethodId)
      await updateBillingAgreementMethod(agreement.id, billingMethodId)
      toast.success(t("changeSuccess"))
      setAgreement({ ...agreement, billingMethodId })
    } catch {
      toast.error(t("changeFail"))
    } finally {
      setIsChanging(null)
    }
  }

  const handleSubscribeWithMethod = async (billingMethodId: string) => {
    if (!planId || isChanging) return

    try {
      setIsChanging(billingMethodId)
      await subscribeWithBillingMethod(planId, billingMethodId, "recurring", crypto.randomUUID())
      toast.success(t("trialStartedSuccess"))
      router.push(`/${countryCode}/mypage/membership/subscribe/success`)
    } catch {
      toast.error(t("subscribeFail"))
    } finally {
      setIsChanging(null)
    }
  }

  const handleRegisterNewCard = () => {
    const walletWebUrl =
      process.env.NEXT_PUBLIC_WALLET_WEB_URL ?? "http://localhost:3200"
    const returnUrl = window.location.href
    const params = new URLSearchParams({ returnUrl })
    if (agreement?.id) params.set("agreementId", agreement.id)
    window.location.href = `${walletWebUrl}/billing-change?${params}`
  }

  useEffect(() => {
    if (!autoSubscribeOnLoad.current || isLoading || otherMethods.length === 0) return
    autoSubscribeOnLoad.current = false
    handleSubscribeWithMethod(otherMethods[0].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, otherMethods])

  if (isLoading) {
    return <MembershipPaymentMethodSkeleton />
  }

  // CMS 등록 직후 돌아왔으나 심사 대기 중이라 사용 가능한 수단이 없는 경우 — 무한 스켈레톤 방지
  if (autoSubscribeOnLoad.current && otherMethods.length === 0) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-white px-6 font-['Pretendard']">
        <div className="w-full max-w-md rounded-md bg-amber-50 border border-amber-200 p-6 text-center">
          <p className="text-sm font-semibold text-amber-800">{t("cmsPendingTitle")}</p>
          <p className="mt-2 text-xs leading-relaxed text-amber-700">{t("cmsPendingDesc")}</p>
          <button
            className="mt-4 rounded-md bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600"
            onClick={() => router.push(`/${countryCode}/mypage/membership`)}
          >
            {t("backAria")}
          </button>
        </div>
      </div>
    )
  }

  const formattedNextBillingDate = formatDate(nextBillingDate, undefined, "")

  return (
    <div className="flex min-h-screen flex-col bg-white font-['Pretendard']">
      <div className="mx-auto flex w-full flex-1 flex-col">
        {/* 헤더 */}
        <header className="flex w-full shrink-0 items-center border-b border-gray-200 px-3 py-4 md:px-6 md:py-3">
          <div className="flex-1">
            <button
              aria-label={t("backAria")}
              className="-m-2 p-2 text-black"
              onClick={() => router.back()}
            >
              <IconChevronLeft />
            </button>
          </div>
          <h1 className="flex-1 text-center text-base font-bold text-black">
            {t("pageTitle")}
          </h1>
          <div className="flex-1" />
        </header>

        {/* 콘텐츠 */}
        <div className="flex-1 overflow-y-auto px-6 py-8">
          <div className="flex flex-col gap-8">
            {!isSubscribeFlow && (
              <>
                {/* 현재 정기결제 카드 */}
                <section aria-labelledby="current-method-title">
                  <h2
                    id="current-method-title"
                    className="text-xs font-bold leading-4 text-black"
                  >
                    {t("currentCardTitle")}
                  </h2>
                  <div className="mt-3">
                    {currentMethod ? (
                      <div className="flex items-center gap-3 rounded-md border border-gray-200 bg-gray-50 p-4">
                        <IconCheckCircle />
                        <div className="flex flex-1 flex-col gap-0.5">
                          <p className="text-sm font-semibold text-black">
                            {currentMethod.displayName ?? t("registeredCard")}
                          </p>
                          <span className="w-fit rounded bg-gray-200 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">
                            {providerLabel(currentMethod.providerType)}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-md bg-gray-100 p-4">
                        <p className="text-xs leading-4 text-gray-600">
                          {agreement
                            ? t("cardLoadError")
                            : t("noRecurringMethod")}
                        </p>
                      </div>
                    )}
                  </div>
                </section>

                {/* 결제 안내 */}
                <section aria-label={t("billingAriaLabel")}>
                  <p className="text-xs font-medium leading-relaxed text-gray-600">
                    {formattedNextBillingDate
                      ? t.rich("nextBillingDateNotice", {
                          strong: () => (
                            <strong className="text-black">
                              {formattedNextBillingDate}
                            </strong>
                          ),
                        })
                      : t("nextBillingUnavailable")}
                    <br />
                    {t("billingFailureNotice")}
                  </p>
                </section>
              </>
            )}

            {otherMethods.length > 0 && (
              <section
                aria-label={isSubscribeFlow ? t("registeredCardsList") : t("changeOtherCard")}
                className="flex flex-col gap-3"
              >
                <h2 className="text-xs font-bold leading-4 text-black">
                  {isSubscribeFlow ? t("registeredCardsList") : t("changeOtherCard")}
                </h2>
                {otherMethods.map((method) => (
                  <div
                    key={method.id}
                    className="flex flex-col gap-3 rounded-md bg-gray-100 p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex flex-col gap-0.5">
                      <p className="text-sm font-medium text-black">
                        {method.displayName ?? t("registeredCard")}
                      </p>
                      <span className="w-fit rounded bg-gray-200 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">
                        {providerLabel(method.providerType)}
                      </span>
                    </div>
                    <button
                      className="shrink-0 rounded-sm border border-gray-400 bg-white px-2.5 py-1.5 text-xs font-normal leading-4 text-black shadow-sm transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                      onClick={() =>
                        isSubscribeFlow
                          ? handleSubscribeWithMethod(method.id)
                          : handleChangeMethod(method.id)
                      }
                      disabled={isChanging === method.id || !!isChanging}
                    >
                      {isChanging === method.id
                        ? t("processing")
                        : isSubscribeFlow
                          ? t("subscribeWithCard")
                          : t("changeToCard")}
                    </button>
                  </div>
                ))}
              </section>
            )}
          </div>
        </div>

        {/* 푸터: 새 카드 등록 */}
        <footer className="w-full shrink-0">
          <div className="border-t border-gray-200 bg-white p-4">
            <button
              className="w-full rounded-md bg-amber-500 px-4 py-3 text-center text-sm font-semibold leading-5 text-white transition-colors hover:bg-amber-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={handleRegisterNewCard}
              disabled={!!isChanging}
            >
              {t("registerNewCard")}
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
