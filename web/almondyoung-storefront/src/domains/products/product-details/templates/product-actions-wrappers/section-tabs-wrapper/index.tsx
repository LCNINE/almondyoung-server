import { getRatingSummary } from "@/lib/api/ugc/reviews"
import type { RatingSummary, QnaSummary } from "@/lib/types/ui/ugc"
import { SectionTabs } from "../../../components/section-nav"
import { getQnaSummary } from "@/lib/api/ugc"

interface Props {
  productId: string
  children: React.ReactNode
}

export async function SectionTabsWrapper({ productId, children }: Props) {
  const ratingSummary: RatingSummary | null = await getRatingSummary(
    productId
  ).catch(() => null)

  const questionSummary: QnaSummary | null = await getQnaSummary(
    productId
  ).catch(() => null)

  return (
    <SectionTabs
      reviewCount={ratingSummary?.totalCount ?? 0}
      qnaCount={questionSummary?.totalCount ?? 0}
    >
      {children}
    </SectionTabs>
  )
}
