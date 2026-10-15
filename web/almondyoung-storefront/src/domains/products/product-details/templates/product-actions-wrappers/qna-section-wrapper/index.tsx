import { QnaList } from "@/components/qna/qna-list"
import {
  QNA_ITEMS_PER_PAGE,
  visibleQuestions,
} from "@/components/qna/visible-questions"
import { getQuestionsByProductId } from "@/lib/api/ugc/qna"

interface Props {
  productId: string
  productName: string
  productThumbnail: string | null
}

/**
 * 첫 목록을 서버에서 받아 내려준다. 클라이언트가 마운트하자마자 서버 액션으로 받으면
 * 같은 순간 `v_id` 를 쓰는 history.replaceState 가 그 액션을 버리게 만들고,
 * Next 는 버린 액션을 메우려고 페이지 전체를 다시 받는다 (상세 진입마다 RSC 한 벌 추가).
 */
export async function QnaSectionWrapper({
  productId,
  productName,
  productThumbnail,
}: Props) {
  const result = await getQuestionsByProductId({
    productId,
    sort: "latest",
    page: 1,
    limit: QNA_ITEMS_PER_PAGE,
  }).catch(() => null)

  return (
    <QnaList
      productId={productId}
      productName={productName}
      productThumbnail={productThumbnail}
      initialQuestions={result ? visibleQuestions(result.data) : null}
      initialTotal={result?.total ?? 0}
    />
  )
}
