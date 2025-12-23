"use client"

import { findPwByEmailAndLoginId } from "@lib/api/users/forgot/find-pwby-email-and-loginId"
import { useState } from "react"
import { toast } from "sonner"

export const useForgetPw = () => {
  const [isLoading, setIsLoading] = useState(false)
  const [isSent, setIsSent] = useState(false)

  const forgetPw = async (email: string, loginId: string) => {
    setIsLoading(true)

    try {
      await findPwByEmailAndLoginId(email, loginId)
      setIsSent(true)

      return { success: true }
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
