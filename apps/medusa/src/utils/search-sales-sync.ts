/**
 * 누적 판매 수량을 search 색인으로 밀어 넣는다.
 *
 * 판매 데이터는 Medusa `product_sort_index` 에만 있고 Kafka 로 나오지 않아서, membership
 * 의 `internal/*` 를 부르는 것과 같은 방식(Bearer 키 HTTP)으로 직접 보낸다.
 *
 * 실패는 삼킨다 — 판매량은 랭킹의 동점 처리용이라, 못 보냈다고 주문 처리가 깨지면 안 된다.
 * 놓친 건 `sync-sales-count-to-search` 백필이 다음 실행에서 따라잡는다.
 */
const SEARCH_SERVICE_URL = process.env.SEARCH_SERVICE_URL || 'http://localhost:3060';

// search 쪽 DTO 의 ArrayMaxSize 와 같은 값
export const SALES_SYNC_BATCH_SIZE = 1000;

export interface SalesCountEntry {
  /** 상품 마스터 ID = Medusa handle = 색인 문서 ID */
  masterId: string;
  salesCount: number;
}

interface SyncLogger {
  info: (message: string) => void;
  warn: (message: string) => void;
}

export async function pushSalesCounts(
  entries: SalesCountEntry[],
  logger?: SyncLogger,
): Promise<{ received: number; applied: number } | null> {
  if (entries.length === 0) return null;

  const key = process.env.SEARCH_INTERNAL_KEY;
  if (!key) {
    logger?.warn('[SalesSync] SEARCH_INTERNAL_KEY 미설정 — 판매량 색인 반영을 건너뛴다');
    return null;
  }

  try {
    const response = await fetch(`${SEARCH_SERVICE_URL}/search/products/internal/sales-counts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ items: entries }),
    });

    if (!response.ok) {
      logger?.warn(`[SalesSync] search 응답 ${response.status} — ${entries.length}건 건너뜀`);
      return null;
    }
    return (await response.json()) as { received: number; applied: number };
  } catch (err: any) {
    logger?.warn(`[SalesSync] search 호출 실패 (${err?.message}) — ${entries.length}건 건너뜀`);
    return null;
  }
}
