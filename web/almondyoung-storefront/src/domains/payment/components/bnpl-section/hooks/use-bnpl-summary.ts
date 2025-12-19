import { getBnplSummary } from "@lib/api/wallet"
import { BnplSummaryDto } from "@lib/types/dto/wallet"
import useSWR from "swr"

export const useBnplSummary = (enabled: boolean = true) => {
  const { data, error, isLoading, mutate } = useSWR<BnplSummaryDto>(
    // enabled가 false이면 null을 반환하여 요청을 하지 않음
    enabled ? "/wallet/payments/bnpl/summary" : null,
    getBnplSummary,
    {
      dedupingInterval: 2 * 60 * 1000, // 2분
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      focusThrottleInterval: 5 * 60 * 1000, // 5분
    }
  )

  return {
    bnplSummary: data ?? null,
    isPending: isLoading,
    error,
    // 필요시 수동으로 다시 가져올 수 있도록
    refetch: mutate,
  }
}
