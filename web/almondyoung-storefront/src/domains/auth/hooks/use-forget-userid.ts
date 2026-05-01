"use client"

import { findIdByPhoneNumber } from "@lib/api/users/forgot/find-by-phone"
import { useState } from "react"
import { toast } from "sonner"

export const useForgetUserId = () => {
  const [isLoading, setIsLoading] = useState(false)
  const [isSent, setIsSent] = useState(false)

  const forgetUserId = async (phoneNumber: string) => {
    setIsLoading(true)

    try {
      const result = await findIdByPhoneNumber(phoneNumber)

      if ("data" in result) {
        setIsSent(true)
        return { success: true, loginIds: result.data.loginIds }
      }

      toast.error(result.error.message)
      setIsSent(false)
      return { success: false, error: result.error }
    } catch (error: any) {
      toast.error(error?.error?.message || "오류가 발생했습니다.")
      setIsSent(false)
      return { success: false, error }
    } finally {
      setIsLoading(false)
    }
  }

  return { forgetUserId, isLoading, isSent }
}
