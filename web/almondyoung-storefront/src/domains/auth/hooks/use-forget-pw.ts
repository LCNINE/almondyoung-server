"use client"

import { findPwByPhoneAndLoginId } from "@lib/api/users/forgot/find-pwby-phone-and-loginId"
import { useState } from "react"
import { toast } from "sonner"

export const useForgetPw = () => {
  const [isLoading, setIsLoading] = useState(false)
  const [isSent, setIsSent] = useState(false)

  const forgetPw = async (phoneNumber: string, loginId: string) => {
    setIsLoading(true)

    try {
      const result = await findPwByPhoneAndLoginId(phoneNumber, loginId)
      if ("data" in result) {
        setIsSent(true)
        return {
          success: true,
          verificationToken: result.data.verificationToken,
        }
      }

      toast.error(result.error.message)
      setIsSent(false)
      return { success: false, error: result.error }
    } catch (error: any) {
      console.error(error)
      toast.error(error?.error?.message || "오류가 발생했습니다.")
      setIsSent(false)
      return { success: false, error }
    } finally {
      setIsLoading(false)
    }
  }

  return { forgetPw, isLoading, isSent }
}
