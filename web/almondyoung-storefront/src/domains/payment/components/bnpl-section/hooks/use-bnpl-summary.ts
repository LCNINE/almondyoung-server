import { getBnplSummary } from "@lib/api/wallet"
import { BnplSummaryDto } from "@lib/types/dto/wallet"
import { useEffect, useState, useTransition } from "react"

export const useBnplSummary = () => {
  const [bnplSummary, setBnplSummary] = useState<BnplSummaryDto | null>(null)
  const [isPending, startTransition] = useTransition()

  const fetchBnplSummary = () => {
    startTransition(async () => {
      try {
        const bnplSummary = await getBnplSummary()
        setBnplSummary(bnplSummary)
      } catch (error) {
        console.error("Failed to fetch BNPL summary:", error)
      }
    })
  }

  useEffect(() => {
    fetchBnplSummary()
  }, [])

  return { fetchBnplSummary, bnplSummary, isPending }
}
