"use client"

import { Spinner } from "@components/common/spinner"
import { medusaSignin } from "@lib/api/medusa/signin"
import { useRouter } from "next/navigation"
import { useEffect, useTransition } from "react"
import { toast } from "sonner"

export function AuthCallback({
  redirectTo,
  success,
}: {
  redirectTo: string
  success: boolean
}) {
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  useEffect(() => {
    startTransition(async () => {
      try {
        await medusaSignin()
        router.push(redirectTo)
      } catch (err) {
        console.error(err)
        toast.error(err instanceof Error ? err.message : "오류가 발생했습니다")
      }
    })
  }, [redirectTo, router])

  return (
    <div className="flex h-screen flex-col items-center justify-center">
      <Spinner size="lg" color="gray" />
    </div>
  )
}
