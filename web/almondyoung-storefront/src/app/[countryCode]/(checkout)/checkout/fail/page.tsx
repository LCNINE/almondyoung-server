"use client"
import { useSearchParams, useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import CheckoutHeader from "@/app/[countryCode]/(checkout)/checkout/checkout-header"

export default function CheckoutFailPage() {
  const t = useTranslations("checkout.fail")
  const tHeader = useTranslations("checkout.header")
  const searchParams = useSearchParams()
  const router = useRouter()
  const [errorInfo, setErrorInfo] = useState<{
    code: string
    message: string
  } | null>(null)

  useEffect(() => {
    const code = searchParams.get("code") || "UNKNOWN_ERROR"
    const message = searchParams.get("message") || t("unknownError")

    setErrorInfo({ code, message })
  }, [searchParams, t])

  const handleGoBack = () => {
    router.back()
  }

  const handleRetry = () => {
    router.back()
  }

  if (!errorInfo) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f8f8f8]">
        <div className="text-center">
          <p className="text-gray-600">{t("loading")}</p>
        </div>
      </div>
    )
  }

  return (
    <main className="flex min-h-screen w-full flex-col items-center gap-[41px] bg-[#f8f8f8] pb-20">
      <CheckoutHeader title={tHeader("title")} />

      <div className="w-full max-w-md rounded-lg bg-white p-8 shadow-lg">
        {/* Title */}
        <h1 className="mb-2 text-center text-2xl font-bold text-gray-900">
          {t("title")}
        </h1>
        <p className="mb-8 text-center text-gray-600">
          {t("description")}
          <br />
          <span className="text-sm font-medium text-red-900">
            {errorInfo.message}
          </span>
        </p>

        <div className="mb-8 space-y-4">
          <div className="bg-gray-10 rounded-lg p-4">
            <h3 className="mb-2 text-sm font-medium text-gray-900">
              {t("commonCausesTitle")}
            </h3>
            <ul className="list-inside list-disc space-y-1 text-sm text-gray-600">
              <li>{t("causes.limitExceeded")}</li>
              <li>{t("causes.cardError")}</li>
              <li>{t("causes.lowBalance")}</li>
              <li>{t("causes.userCancel")}</li>
              <li>{t("causes.networkError")}</li>
            </ul>
          </div>
        </div>

        <div className="space-y-3">
          <button
            onClick={handleRetry}
            className="w-full rounded-lg bg-[#F29219] py-3 font-medium text-white transition-colors hover:bg-[#e08219]"
          >
            {t("retry")}
          </button>
          <button
            onClick={handleGoBack}
            className="w-full rounded-lg bg-gray-200 py-3 font-medium text-gray-700 transition-colors hover:bg-gray-300"
          >
            {t("goBack")}
          </button>
        </div>
      </div>
    </main>
  )
}
