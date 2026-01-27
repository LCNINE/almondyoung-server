"use client"

import { updateCart } from "@/lib/api/medusa/cart"
import { getCustomerAddresses } from "@/lib/api/medusa/customer"
import { StoreCartAddress } from "@medusajs/types"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useTransition } from "react"
import { toast } from "sonner"
import {
  getAutoFillMessage,
  isValidAddress,
  selectAutoFillAddress,
} from "../utils"

interface UseAutoFillShippingOptions {
  shippingAddress: StoreCartAddress | null
}

/**
 * 카트에 연결된 배송지가 없을 때 고객의 저장된 주소를 자동으로 채워주는 훅
 */
export function useAutoFillShipping({
  shippingAddress,
}: UseAutoFillShippingOptions) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const hasAttemptedRef = useRef(false)

  useEffect(() => {
    // 이미 시도했거나 배송지가 있으면 스킵
    if (hasAttemptedRef.current || isValidAddress(shippingAddress)) {
      return
    }

    hasAttemptedRef.current = true

    startTransition(async () => {
      try {
        const addresses = await getCustomerAddresses()
        if (!addresses || addresses.length === 0) {
          return
        }

        const { address, reason } = selectAutoFillAddress(addresses)
        if (!address) {
          return
        }

        await updateCart({
          shipping_address: {
            first_name: address.first_name ?? "",
            last_name: address.last_name ?? "",
            phone: address.phone ?? "",
            province: address.province ?? "",
            city: address.city ?? "",
            address_1: address.address_1 ?? "",
            address_2: address.address_2 ?? "",
            postal_code: address.postal_code ?? "",
            country_code: address.country_code ?? "kr",
          },
          metadata: {
            shipping_address_name: address.address_name || null,
          },
        })

        const message = getAutoFillMessage(reason)
        if (message) {
          toast.success(message)
        }

        router.refresh()
      } catch (error) {
        console.error("자동 배송지 설정 실패:", error)
      }
    })
  }, [shippingAddress, router])

  return { isAutoFilling: isPending }
}
