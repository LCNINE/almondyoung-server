import { getBnplHistory } from "@lib/api/wallet"
import { useState, useTransition } from "react"
import { BnplHistoryDto } from "@lib/types/dto/wallet"

export const useBnplHistory = () => {
  const [isPending, startTransition] = useTransition()
  const [data, setData] = useState<BnplHistoryDto | null>(null)

  const fetchBnplHistory = (year: number, month: number) => {
    startTransition(async () => {
      try {
        const bnplHistory = await getBnplHistory(year, month)
        setData(bnplHistory)
      } catch (error) {
        console.error("Failed to fetch BNPL history:", error)
      }
    })
  }

  return { fetchBnplHistory, data, isPending }
}
