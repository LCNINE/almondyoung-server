import { listMadeToOrderPrintMasterIds } from "@/lib/api/print/print-product"

// 카드마다 서버를 부르지 않게 한 번 받아 브라우저에 둔다. 늦으면 막지 않고 넘어가며, 그때는 다음 클릭에 다시 받는다
const WAIT_MS = 1500

let cached: Promise<Set<string>> | null = null

export function madeToOrderMasterIds(): Promise<Set<string>> {
  if (cached) {
    return cached
  }

  const loading = listMadeToOrderPrintMasterIds()
    .then((ids) => new Set(ids))
    .catch(() => new Set<string>())
  cached = loading

  return Promise.race([
    loading,
    new Promise<Set<string>>((resolve) =>
      setTimeout(() => {
        cached = null
        resolve(new Set())
      }, WAIT_MS)
    ),
  ])
}
