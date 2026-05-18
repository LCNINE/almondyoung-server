"use client"

import { useParams, useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { InquiryForm } from "./inquiry-form"

interface InquiryProps {
  product?: { id: string; title: string }
}

export function Inquiry({ product }: InquiryProps) {
  const router = useRouter()
  const { countryCode } = useParams<{ countryCode: string }>()
  const searchParams = useSearchParams()
  const t = useTranslations("cs.inquiry")
  const productId = product?.id ?? searchParams.get("productId") ?? undefined

  const handleSuccess = () => {
    toast.success(t("successToast"), {
      description: t("successDesc"),
      action: {
        label: t("successAction"),
        onClick: () => router.push(`/${countryCode}/mypage/inquiries`),
      },
    })
  }

  return (
    <div className="px-4 py-6">
      <div className="mb-6">
        <h2 className="text-lg font-bold">{t("title")}</h2>
        <p className="mt-1 text-sm text-gray-500">{t("subtitle")}</p>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <InquiryForm
          productId={productId}
          productTitle={product?.title}
          onSuccess={handleSuccess}
        />
      </div>

      <div className="mt-6 border-t border-gray-100 pt-4">
        <p className="text-xs text-gray-400">{t("footerNotice")}</p>
      </div>
    </div>
  )
}
