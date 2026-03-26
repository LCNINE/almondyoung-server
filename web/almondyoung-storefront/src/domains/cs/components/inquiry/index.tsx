"use client"

import { useParams, useRouter, useSearchParams } from "next/navigation"
import { InquiryForm } from "./inquiry-form"

interface InquiryProps {
  product?: { id: string; title: string }
}

export function Inquiry({ product }: InquiryProps) {
  const router = useRouter()
  const { countryCode } = useParams<{ countryCode: string }>()
  const searchParams = useSearchParams()
  const productId = product?.id ?? searchParams.get("productId") ?? undefined

  const handleSuccess = () => {
    router.push(`/${countryCode}/mypage/inquiries`)
  }

  return (
    <div className="px-4 py-6">
      <div className="mb-6">
        <h2 className="text-lg font-bold">1:1 문의</h2>
        <p className="mt-1 text-sm text-gray-500">
          문의하신 내용은 빠른 시간 내에 답변드리겠습니다.
        </p>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <InquiryForm
          productId={productId}
          productTitle={product?.title}
          onSuccess={handleSuccess}
        />
      </div>

      <div className="mt-6 border-t border-gray-100 pt-4">
        <p className="text-xs text-gray-400">
          운영시간: 평일 09:00 - 18:00 (주말/공휴일 휴무) | 접수 순서대로 답변 드리며, 최대 3영업일이 소요됩니다.
        </p>
      </div>
    </div>
  )
}
