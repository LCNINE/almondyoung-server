import { getBnplHistory } from "@lib/api/wallet"
import { BnplHistoryDto } from "@lib/types/dto/wallet"
import useSWR from "swr"

export const useBnplHistory = (
  year: number,
  month: number,
  enabled: boolean = true
) => {
  const { data, error, isLoading } = useSWR<BnplHistoryDto>(
    // enabled가 false이면 null을 반환하여 요청을 하지 않음
    enabled ? [`/wallet/payments/bnpl/history`, year, month] : null,
    () => getBnplHistory(year, month),
    {
      // 캐시 유지 시간: 5분
      dedupingInterval: 5 * 60 * 1000,
      // 포커스시 자동 재검증 비활성화
      revalidateOnFocus: false,
      // 재연결시 자동 재검증 비활성화
      revalidateOnReconnect: false,
      // 데이터가 오래되었다고 판단하는 시간: 10분
      focusThrottleInterval: 10 * 60 * 1000,
    }
  )

  return {
    data: data ?? null,
    isPending: isLoading,
    error,
  }
}
