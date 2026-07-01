"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useEffect, useRef } from "react"
import { usePaymentMethodModalStore } from "./store/payment-method-modal-store"

// URL 파라미터(openWizard=cms)로 진입하면 CMS 자동이체 등록 위저드를 자동으로 연다.
// 멤버십 결제수단 화면의 "신규 등록" CTA 가 이 파라미터를 붙여 보낸다.
// 위저드를 닫은 뒤 재오픈 루프를 막기 위해 한 번만 열고 openWizard 파라미터만 제거한다(returnTo 등은 보존).
export default function PaymentMethodModalAutoOpen() {
  const openModal = usePaymentMethodModalStore((s) => s.openModal)
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const opened = useRef(false)

  useEffect(() => {
    if (opened.current) return
    if (searchParams.get("openWizard") !== "cms") return
    opened.current = true
    openModal()

    const params = new URLSearchParams(searchParams.toString())
    params.delete("openWizard")
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname)
  }, [openModal, searchParams, router, pathname])

  return null
}
