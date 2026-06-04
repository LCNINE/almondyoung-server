"use server"

import { deleteBillingMethod } from "@lib/api/wallet"
import { HttpApiError } from "@lib/api/api-error"

export type DeleteBillingMethodActionResult = {
  success: boolean
  error?: string
}

export async function deleteBillingMethodAction(
  billingMethodId: string
): Promise<DeleteBillingMethodActionResult> {
  try {
    await deleteBillingMethod(billingMethodId)
    return { success: true }
  } catch (error) {
    if (error instanceof HttpApiError && error.status === 401) {
      throw error
    }

    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "결제수단 삭제에 실패했습니다.",
    }
  }
}
