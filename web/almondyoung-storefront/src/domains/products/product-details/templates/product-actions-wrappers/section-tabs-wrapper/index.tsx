import { getRatingSummary } from "@/lib/api/ugc/reviews"
import { getQnaSummary } from "@/lib/api/ugc"
import type { RatingSummary, QnaSummary } from "@/lib/types/ui/ugc"
import { SectionTabs } from "../../../components/section-nav"
import { Suspense } from "react"

interface Props {
  /** PIM 마스터 id. 없으면 뱃지 조회를 건너뛴다 — 뱃지는 원래도 0건이면 안 그린다 */
  productId: string | undefined
  children: React.ReactNode
}

export function SectionTabsWrapper({ productId, children }: Props) {
  return (
    <SectionTabs
      reviewCountSlot={
        <Suspense fallback={null}>
          <ReviewCountBadge productId={productId} />
        </Suspense>
      }
      qnaCountSlot={
        <Suspense fallback={null}>
          <QnaCountBadge productId={productId} />
        </Suspense>
      }
    >
      {children}
    </SectionTabs>
  )
}

async function ReviewCountBadge({ productId }: { productId: string | undefined }) {
  if (!productId) return null
  const summary: RatingSummary | null = await getRatingSummary(productId).catch(
    () => null
  )
  if (!summary || summary.totalCount <= 0) return null
  return (
    <span className="ml-0.5 text-[0.65em] tabular-nums opacity-80">
      {summary.totalCount.toLocaleString()}
    </span>
  )
}

async function QnaCountBadge({ productId }: { productId: string | undefined }) {
  if (!productId) return null
  const summary: QnaSummary | null = await getQnaSummary(productId).catch(
    () => null
  )
  if (!summary || summary.totalCount <= 0) return null
  return (
    <span className="ml-0.5 text-[0.65em] tabular-nums opacity-80">
      {summary.totalCount.toLocaleString()}
    </span>
  )
}
