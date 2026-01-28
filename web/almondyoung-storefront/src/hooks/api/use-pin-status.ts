import { HttpApiError } from "@/lib/api/api-error"
import { getPinStatus, type PinStatus } from "@/lib/api/wallet"
import { useCallback, useState, useTransition } from "react"
import { toast } from "sonner"

export const usePinStatus = () => {
  const [isPending, startTransition] = useTransition()
  const [pinStatus, setPinStatus] = useState<PinStatus | null>(null)

  const fetchPinStatus = useCallback(async () => {
    startTransition(() => {
      void (async () => {
        try {
          const response = await getPinStatus()
          setPinStatus(response)
        } catch (err) {
          if (err instanceof HttpApiError) {
            toast.error(err.message)
            return
          }

          toast.error("PIN 상태 조회에 실패했습니다")
        }
      })()
    })
  }, [])

  return {
    isPending,
    pinStatus,
    fetchPinStatus,
  }
}
