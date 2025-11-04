"use client"

import { findIdByEmail } from "@lib/api/users/auth"
import { useState } from "react"
import { toast } from "sonner"

export const useForgetUserId = () => {
  const [isLoading, setIsLoading] = useState(false)
  const [isSent, setIsSent] = useState(false)

  const forgetUserId = async (email: string) => {
    setIsLoading(true)

    try {
      await findIdByEmail(email)
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

  return { forgetUserId, isLoading, isSent }
}
