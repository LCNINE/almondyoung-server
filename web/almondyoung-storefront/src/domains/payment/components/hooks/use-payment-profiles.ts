import { getPaymentProfiles, PaymentProfile } from "@lib/api/wallet"
import { use, useEffect, useState } from "react"

export const usePaymentProfiles = () => {
  const [data, setData] = useState<PaymentProfile[]>([])

  useEffect(() => {
    getPaymentProfiles().then((data) => {
      setData(data)
    })
  }, [])

  return data
}
