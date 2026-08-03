type RatingSummary = {
  averageRating: number
  totalCount: number
}

const EMPTY: RatingSummary = { averageRating: 0, totalCount: 0 }

const toFiniteNumber = (value: unknown) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0
  if (typeof value === "string") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

type Pending = { productId: string; resolve: (summary: RatingSummary) => void }

let queue: Pending[] = []
let scheduled = false

/**
 * 상품 카드 하나당 평점 요청이 하나씩 나가면, 목록 20개 기준 요청 20개가 브라우저 동시연결
 * 6개 제한에 걸려 직렬화된다(정렬 변경 시 마지막 응답까지 2.7초 관측). 카드는 각자 요청하는
 * 코드 그대로 두고, 같은 tick 에 모인 요청을 여기서 한 번으로 합친다.
 *
 * 무한 스크롤로 나중에 붙는 카드들은 자연히 다음 배치로 묶인다.
 */
export const fetchRatingSummaryBatched = (
  productId: string
): Promise<RatingSummary> =>
  new Promise((resolve) => {
    queue.push({ productId, resolve })

    if (scheduled) return
    scheduled = true
    // 매크로태스크 — 같은 렌더에서 마운트된 카드들의 effect 가
    // 전부 큐에 들어온 뒤에 보내야 한 번으로 합쳐진다.
    setTimeout(flush, 0)
  })

/** 서버 DTO 의 ArrayMaxSize 와 맞춘 값. 넘기면 배치 전체가 400 이 되어 평점이 통째로 사라진다. */
const MAX_IDS_PER_REQUEST = 100

function flush() {
  const batch = queue
  queue = []
  scheduled = false

  if (batch.length === 0) return

  const ids = Array.from(new Set(batch.map((item) => item.productId)))
  const byId = new Map<string, RatingSummary>()
  const settle = () => {
    for (const item of batch) {
      item.resolve(byId.get(item.productId) ?? EMPTY)
    }
  }

  const chunks: string[][] = []
  for (let i = 0; i < ids.length; i += MAX_IDS_PER_REQUEST) {
    chunks.push(ids.slice(i, i + MAX_IDS_PER_REQUEST))
  }

  Promise.all(
    chunks.map((chunk) =>
      fetch(
        `/api/ugc/rating-summary?${new URLSearchParams({ productIds: chunk.join(",") })}`,
        { cache: "no-store" }
      )
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          const summaries: unknown[] = Array.isArray(data?.summaries)
            ? data.summaries
            : []

          for (const raw of summaries) {
            const item = raw as Record<string, unknown>
            byId.set(String(item.productId), {
              averageRating: toFiniteNumber(item.averageRating),
              totalCount: toFiniteNumber(item.totalCount),
            })
          }
        })
        // 한 청크가 실패해도 나머지 청크의 평점은 살린다.
        .catch(() => undefined)
    )
    // 평점은 부가 정보라 실패해도 카드는 그대로 그려져야 한다.
  ).then(settle, settle)
}
