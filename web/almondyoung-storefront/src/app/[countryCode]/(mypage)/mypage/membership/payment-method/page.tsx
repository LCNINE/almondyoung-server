"use client"

import {
  getBillingAgreements,
  getBillingMethods,
  getCmsBillingMethodStatuses,
  updateBillingAgreementMethod,
} from "@lib/api/wallet"
import {
  getCurrentSubscription,
  subscribeWithBillingMethod,
} from "@lib/api/membership"
import type {
  BillingAgreementDto,
  BillingMethodDto,
  CmsBillingMethodStatusDto,
} from "@lib/types/dto/wallet"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import { useEffect, useMemo, useRef, useState, useTransition } from "react"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { MembershipPaymentMethodSkeleton } from "@/components/skeletons/page-skeletons"
import { providerLabel } from "@lib/utils/billing-provider"
import { formatDate } from "@lib/utils/format-date"
import { deleteBillingMethodAction } from "./actions"

const IconChevronLeft = () => (
  <svg
    className="h-5 w-5"
    viewBox="0 0 20 20"
    fill="currentColor"
    aria-hidden="true"
  >
    <path
      fillRule="evenodd"
      d="M12.79 5.23a.75.75 0 010 1.06L9.06 10l3.73 3.71a.75.75 0 11-1.06 1.06l-4.25-4.25a.75.75 0 010-1.06l4.25-4.25a.75.75 0 011.06 0z"
      clipRule="evenodd"
    />
  </svg>
)

const IconCheckCircle = () => (
  <svg
    className="h-4 w-4 text-green-500"
    viewBox="0 0 20 20"
    fill="currentColor"
    aria-hidden="true"
  >
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
  const countryCode =
    typeof params.countryCode === "string" ? params.countryCode : "kr"
  const searchParams = useSearchParams()
  const t = useTranslations("mypage.membershipPaymentMethod")

  const planId = searchParams.get("planId")
  const redirect = searchParams.get("redirect")
  const isSubscribeFlow = redirect === "subscribe" && !!planId
  const autoSubscribeOnLoad = useRef(
    isSubscribeFlow && searchParams.get("cardChanged") === "1"
  )

  const [isLoading, setIsLoading] = useState(true)
  const [agreement, setAgreement] = useState<BillingAgreementDto | null>(null)
  const [allMethods, setAllMethods] = useState<BillingMethodDto[]>([])
  const [cmsBillingStatuses, setCmsBillingStatuses] = useState<
    CmsBillingMethodStatusDto[]
  >([])
  const [nextBillingDate, setNextBillingDate] = useState<string | null>(null)
  const [isChanging, setIsChanging] = useState<string | null>(null)
  const [detailOpenId, setDetailOpenId] = useState<string | null>(null)
  const [isActionPending, startActionTransition] = useTransition()

  const currentMethod =
    allMethods.find((m) => m.id === agreement?.billingMethodId) ?? null
  const otherMethods = allMethods.filter(
    (m) => m.status === "ACTIVE" && m.id !== agreement?.billingMethodId
  )
  const pendingCmsMethods = cmsBillingStatuses.filter(
    (s) => s.billingMethodStatus === "ACTIVE" && s.cmsMemberStatus === "PENDING"
  )
  const failedCmsMethods = cmsBillingStatuses.filter(
    (s) => s.billingMethodStatus === "ACTIVE" && s.cmsMemberStatus === "FAILED"
  )
  const cmsStatusByBillingMethodId = useMemo(
    () =>
      new Map(
        cmsBillingStatuses.map((status) => [status.billingMethodId, status])
      ),
    [cmsBillingStatuses]
  )
  const getCmsStatus = (billingMethodId: string) =>
    cmsStatusByBillingMethodId.get(billingMethodId)

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
        const [agreements, methods, cmsStatuses, subscription] =
          await Promise.all([
            getBillingAgreements(),
            getBillingMethods(),
            getCmsBillingMethodStatuses(),
            isSubscribeFlow
              ? Promise.resolve(null)
              : getCurrentSubscription().catch(() => null),
          ])

        const membershipAgreement =
          agreements.find(
            (a) => a.subscriberType === "MEMBERSHIP" && a.status === "ACTIVE"
          ) ?? null

        setAgreement(membershipAgreement)
        setAllMethods(methods.filter((m) => m.status === "ACTIVE"))
        setCmsBillingStatuses(cmsStatuses)
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
      await subscribeWithBillingMethod(
        planId,
        billingMethodId,
        "recurring",
        crypto.randomUUID()
      )
      toast.success(t("trialStartedSuccess"))
      router.push(`/${countryCode}/mypage/membership/subscribe/success`)
    } catch {
      toast.error(t("subscribeFail"))
    } finally {
      setIsChanging(null)
    }
  }

  const isUnauthorizedError = (error: unknown) => {
    const err = error as Error & { digest?: string; status?: number }
    return (
      err.digest === "UNAUTHORIZED" ||
      err.message === "UNAUTHORIZED" ||
      err.status === 401
    )
  }

  const removeMethodFromState = (billingMethodId: string) => {
    setAllMethods((methods) => methods.filter((m) => m.id !== billingMethodId))
    setCmsBillingStatuses((statuses) =>
      statuses.filter((s) => s.billingMethodId !== billingMethodId)
    )
    if (agreement?.billingMethodId === billingMethodId) {
      setAgreement(null)
    }
    if (detailOpenId === billingMethodId) {
      setDetailOpenId(null)
    }
  }

  const handleDeleteMethod = (
    billingMethodId: string,
    confirmMessage: string
  ) => {
    if (isChanging || isActionPending) return
    if (!window.confirm(confirmMessage)) return

    startActionTransition(async () => {
      try {
        setIsChanging(`delete:${billingMethodId}`)
        const result = await deleteBillingMethodAction(billingMethodId)
        if (!result.success) {
          toast.error(result.error ?? t("deleteFail"))
          return
        }

        removeMethodFromState(billingMethodId)
        toast.success(t("deleteSuccess"))
      } catch (error) {
        if (isUnauthorizedError(error)) {
          throw error
        }
        toast.error(t("deleteFail"))
      } finally {
        setIsChanging(null)
      }
    })
  }

  const handleRegisterNewCard = () => {
    const walletWebUrl =
      process.env.NEXT_PUBLIC_WALLET_WEB_URL ?? "http://localhost:3200"
    const returnUrl = window.location.href
    const params = new URLSearchParams({ returnUrl })
    if (agreement?.id) params.set("agreementId", agreement.id)
    window.location.href = `${walletWebUrl}/billing-change?${params}`
  }

  const handleRegisterCmsBankAccount = () => {
    // 실패한 CMS 계좌 재등록 — 은행계좌 등록 흐름이 있는 결제 관리 페이지로 이동
    // returnTo 파라미터로 등록 완료 후 멤버십 결제수단 화면으로 복귀
    const returnTo = encodeURIComponent(
      window.location.pathname + window.location.search
    )
    router.push(`/${countryCode}/mypage/payment?returnTo=${returnTo}`)
  }

  const handleReregisterFailedMethod = (billingMethodId: string) => {
    if (isChanging || isActionPending) return
    if (!window.confirm(t("reregisterConfirm"))) return

    startActionTransition(async () => {
      try {
        setIsChanging(`reregister:${billingMethodId}`)
        const result = await deleteBillingMethodAction(billingMethodId)
        if (!result.success) {
          toast.error(result.error ?? t("deleteFail"))
          return
        }

        removeMethodFromState(billingMethodId)
        handleRegisterCmsBankAccount()
      } catch (error) {
        if (isUnauthorizedError(error)) {
          throw error
        }
        toast.error(t("deleteFail"))
      } finally {
        setIsChanging(null)
      }
    })
  }

  useEffect(() => {
    if (!autoSubscribeOnLoad.current || isLoading || otherMethods.length === 0)
      return
    autoSubscribeOnLoad.current = false
    handleSubscribeWithMethod(otherMethods[0].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, otherMethods])

  if (isLoading) {
    return <MembershipPaymentMethodSkeleton />
  }

  const formattedNextBillingDate = formatDate(nextBillingDate, undefined, "")
  const showAutoSubscribePendingNotice =
    autoSubscribeOnLoad.current &&
    otherMethods.length === 0 &&
    pendingCmsMethods.length > 0

  const renderMethodDetails = (
    billingMethodId: string,
    method?: BillingMethodDto | null,
    status?: CmsBillingMethodStatusDto | null
  ) => {
    if (detailOpenId !== billingMethodId) return null
    const providerType = method?.providerType ?? "CMS_BATCH"

    return (
      <dl className="mt-2 grid grid-cols-1 gap-2 rounded-md bg-white/70 p-3 text-xs text-gray-700 sm:grid-cols-2">
        <div>
          <dt className="font-semibold text-gray-500">{t("detailProvider")}</dt>
          <dd>{providerLabel(providerType)}</dd>
        </div>
        <div>
          <dt className="font-semibold text-gray-500">{t("detailStatus")}</dt>
          <dd>{status?.statusLabel ?? method?.status ?? "-"}</dd>
        </div>
        {status?.paymentCompany && (
          <div>
            <dt className="font-semibold text-gray-500">{t("detailBank")}</dt>
            <dd>{status.paymentCompany}</dd>
          </div>
        )}
        {status?.payerName && (
          <div>
            <dt className="font-semibold text-gray-500">
              {t("detailPayerName")}
            </dt>
            <dd>{status.payerName}</dd>
          </div>
        )}
        {status?.agreementStatus && (
          <div>
            <dt className="font-semibold text-gray-500">
              {t("detailAgreementStatus")}
            </dt>
            <dd>{status.agreementStatus}</dd>
          </div>
        )}
        <div>
          <dt className="font-semibold text-gray-500">
            {t("detailCreatedAt")}
          </dt>
          <dd>
            {formatDate(
              status?.createdAt ?? method?.createdAt ?? null,
              undefined,
              "-"
            )}
          </dd>
        </div>
        {status?.resultMessage && (
          <div className="sm:col-span-2">
            <dt className="font-semibold text-gray-500">
              {t("cmsFailedReason")}
            </dt>
            <dd>{status.resultMessage}</dd>
          </div>
        )}
      </dl>
    )
  }

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
                    className="text-xs leading-4 font-bold text-black"
                  >
                    {t("currentCardTitle")}
                  </h2>
                  <div className="mt-3">
                    {currentMethod ? (
                      <div className="rounded-md border border-gray-200 bg-gray-50 p-4">
                        <div className="flex items-center gap-3">
                          <IconCheckCircle />
                          <div className="flex flex-1 flex-col gap-0.5">
                            <p className="text-sm font-semibold text-black">
                              {currentMethod.displayName ?? t("registeredCard")}
                            </p>
                            <span className="w-fit rounded bg-gray-200 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">
                              {providerLabel(currentMethod.providerType)}
                            </span>
                          </div>
                          <div className="flex shrink-0 gap-2">
                            <button
                              className="rounded-sm border border-gray-300 bg-white px-2.5 py-1.5 text-xs text-black shadow-sm hover:bg-gray-50"
                              onClick={() =>
                                setDetailOpenId(
                                  detailOpenId === currentMethod.id
                                    ? null
                                    : currentMethod.id
                                )
                              }
                            >
                              {detailOpenId === currentMethod.id
                                ? t("hideDetails")
                                : t("viewDetails")}
                            </button>
                            <button
                              className="rounded-sm border border-red-300 bg-white px-2.5 py-1.5 text-xs text-red-700 shadow-sm hover:bg-red-50 disabled:opacity-50"
                              onClick={() =>
                                handleDeleteMethod(
                                  currentMethod.id,
                                  t("deleteRegisteredConfirm")
                                )
                              }
                              disabled={
                                isChanging === `delete:${currentMethod.id}` ||
                                !!isChanging ||
                                isActionPending
                              }
                            >
                              {isChanging === `delete:${currentMethod.id}`
                                ? t("processing")
                                : t("deleteMethod")}
                            </button>
                          </div>
                        </div>
                        {renderMethodDetails(
                          currentMethod.id,
                          currentMethod,
                          getCmsStatus(currentMethod.id)
                        )}
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
                  <p className="text-xs leading-relaxed font-medium text-gray-600">
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
                aria-label={
                  isSubscribeFlow
                    ? t("registeredCardsList")
                    : t("changeOtherCard")
                }
                className="flex flex-col gap-3"
              >
                <h2 className="text-xs leading-4 font-bold text-black">
                  {isSubscribeFlow
                    ? t("registeredCardsList")
                    : t("changeOtherCard")}
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
                      {renderMethodDetails(
                        method.id,
                        method,
                        getCmsStatus(method.id)
                      )}
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <button
                        className="rounded-sm border border-gray-300 bg-white px-2.5 py-1.5 text-xs text-black shadow-sm hover:bg-gray-50"
                        onClick={() =>
                          setDetailOpenId(
                            detailOpenId === method.id ? null : method.id
                          )
                        }
                      >
                        {detailOpenId === method.id
                          ? t("hideDetails")
                          : t("viewDetails")}
                      </button>
                      <button
                        className="rounded-sm border border-gray-400 bg-white px-2.5 py-1.5 text-xs leading-4 font-normal text-black shadow-sm transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
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
                      <button
                        className="rounded-sm border border-red-300 bg-white px-2.5 py-1.5 text-xs text-red-700 shadow-sm hover:bg-red-50 disabled:opacity-50"
                        onClick={() =>
                          handleDeleteMethod(
                            method.id,
                            t("deleteRegisteredConfirm")
                          )
                        }
                        disabled={
                          isChanging === `delete:${method.id}` ||
                          !!isChanging ||
                          isActionPending
                        }
                      >
                        {isChanging === `delete:${method.id}`
                          ? t("processing")
                          : t("deleteMethod")}
                      </button>
                    </div>
                  </div>
                ))}
              </section>
            )}

            {/* 심사중 CMS 계좌 */}
            {showAutoSubscribePendingNotice && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-4">
                <p className="text-sm font-semibold text-amber-800">
                  {t("cmsPendingTitle")}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-amber-700">
                  {t("cmsPendingDesc")}
                </p>
              </div>
            )}

            {pendingCmsMethods.length > 0 && (
              <section
                aria-labelledby="cms-pending-title"
                className="flex flex-col gap-3"
              >
                <h2
                  id="cms-pending-title"
                  className="text-xs leading-4 font-bold text-black"
                >
                  {t("pendingMethodsTitle")}
                </h2>
                {pendingCmsMethods.map((m) => (
                  <div
                    key={m.billingMethodId}
                    className="flex flex-col gap-2 rounded-md border border-amber-200 bg-amber-50 p-4"
                  >
                    <div className="flex items-center gap-2">
                      <p className="flex-1 text-sm font-medium text-black">
                        {m.displayName ?? t("registeredCard")}
                      </p>
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                        {t("cmsPendingBadge")}
                      </span>
                    </div>
                    <p className="text-xs leading-relaxed text-amber-700">
                      {t("cmsPendingNotice")}
                    </p>
                    {renderMethodDetails(m.billingMethodId, null, m)}
                    <div className="flex justify-end gap-2">
                      <button
                        className="rounded-sm border border-amber-300 bg-white px-2.5 py-1.5 text-xs font-normal text-amber-800 shadow-sm hover:bg-amber-50"
                        onClick={() =>
                          setDetailOpenId(
                            detailOpenId === m.billingMethodId
                              ? null
                              : m.billingMethodId
                          )
                        }
                      >
                        {detailOpenId === m.billingMethodId
                          ? t("hideDetails")
                          : t("viewDetails")}
                      </button>
                      <button
                        className="rounded-sm border border-red-300 bg-white px-2.5 py-1.5 text-xs font-normal text-red-700 shadow-sm hover:bg-red-50 disabled:opacity-50"
                        onClick={() =>
                          handleDeleteMethod(
                            m.billingMethodId,
                            t("cancelPendingConfirm")
                          )
                        }
                        disabled={
                          isChanging === `delete:${m.billingMethodId}` ||
                          !!isChanging ||
                          isActionPending
                        }
                      >
                        {isChanging === `delete:${m.billingMethodId}`
                          ? t("processing")
                          : t("cancelPending")}
                      </button>
                    </div>
                  </div>
                ))}
              </section>
            )}

            {failedCmsMethods.length > 0 && (
              <section
                aria-labelledby="cms-failed-title"
                className="flex flex-col gap-3"
              >
                <h2
                  id="cms-failed-title"
                  className="text-xs leading-4 font-bold text-black"
                >
                  {t("failedMethodsTitle")}
                </h2>
                {failedCmsMethods.map((m) => (
                  <div
                    key={m.billingMethodId}
                    className="flex flex-col gap-2 rounded-md border border-red-200 bg-red-50 p-4"
                  >
                    <div className="flex items-center gap-2">
                      <p className="flex-1 text-sm font-medium text-black">
                        {m.displayName ?? t("registeredCard")}
                      </p>
                      <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">
                        {t("cmsFailedBadge")}
                      </span>
                    </div>
                    {m.resultMessage && (
                      <p className="text-xs text-red-600">
                        {t("cmsFailedReason")}: {m.resultMessage}
                      </p>
                    )}
                    <p className="text-xs leading-relaxed text-red-700">
                      {t("cmsFailedNotice")}
                    </p>
                    {renderMethodDetails(m.billingMethodId, null, m)}
                    <div className="flex justify-end gap-2">
                      <button
                        className="rounded-sm border border-red-300 bg-white px-2.5 py-1.5 text-xs font-normal text-red-700 shadow-sm hover:bg-red-50"
                        onClick={() =>
                          setDetailOpenId(
                            detailOpenId === m.billingMethodId
                              ? null
                              : m.billingMethodId
                          )
                        }
                      >
                        {detailOpenId === m.billingMethodId
                          ? t("hideDetails")
                          : t("viewDetails")}
                      </button>
                      <button
                        className="rounded-sm border border-red-300 bg-white px-2.5 py-1.5 text-xs font-normal text-red-700 shadow-sm hover:bg-red-50 disabled:opacity-50"
                        onClick={() =>
                          handleReregisterFailedMethod(m.billingMethodId)
                        }
                        disabled={!!isChanging || isActionPending}
                      >
                        {isChanging === `reregister:${m.billingMethodId}`
                          ? t("processing")
                          : t("cmsReregister")}
                      </button>
                      <button
                        className="rounded-sm border border-red-300 bg-white px-2.5 py-1.5 text-xs font-normal text-red-700 shadow-sm hover:bg-red-50 disabled:opacity-50"
                        onClick={() =>
                          handleDeleteMethod(
                            m.billingMethodId,
                            t("deleteFailedConfirm")
                          )
                        }
                        disabled={
                          isChanging === `delete:${m.billingMethodId}` ||
                          !!isChanging ||
                          isActionPending
                        }
                      >
                        {isChanging === `delete:${m.billingMethodId}`
                          ? t("processing")
                          : t("deleteMethod")}
                      </button>
                    </div>
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
              className="w-full rounded-md bg-amber-500 px-4 py-3 text-center text-sm leading-5 font-semibold text-white transition-colors hover:bg-amber-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={handleRegisterNewCard}
              disabled={!!isChanging || isActionPending}
            >
              {t("registerNewCard")}
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
