import { getQuestionsByProductId } from "@/lib/api/ugc/qna"
import type { QnaSortOption } from "@/lib/types/common/filter"
import { QnaList } from "@/components/qna/qna-list"
import { HttpTypes } from "@medusajs/types"

const ITEMS_PER_PAGE = 10

interface Props {
  product: HttpTypes.StoreProduct
}

export async function QnaSectionWrapper({ product }: Props) {
  const productId = product.metadata?.pimMasterId as string

  const questionResult = await getQuestionsByProductId({
    productId,
    sort: "latest" satisfies QnaSortOption,
    page: 1,
    limit: ITEMS_PER_PAGE,
  }).catch(() => ({ data: [], total: 0, page: 1, limit: ITEMS_PER_PAGE }))

  const initialQuestions = (questionResult.data ?? []).filter(
    (q) => q.status === "active" || q.status === "answered"
  )

  return (
    <QnaList
      productId={productId}
      productName={product.title ?? ""}
      productThumbnail={product.thumbnail ?? null}
      totalQuestions={questionResult.total ?? 0}
      initialQuestions={initialQuestions}
    />
  )
}
