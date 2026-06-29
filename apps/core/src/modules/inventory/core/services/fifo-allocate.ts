/**
 * 출고 소진(consume)용 FIFO 로케이션 할당 — 순수함수.
 *
 * 주어진 (sku, warehouse) 의 ON_HAND `stock_ledgers` 행들에서, 요청 수량을
 * fifoRank(nulls last) → updatedAt(오래된 것 먼저) 순으로 그리디하게 할당한다.
 * 가용 합이 요청량보다 적으면 불변식 위반으로 throw (RFC §7 / ADR-0027 결정 7).
 *
 * raw ON_HAND 만 본다 — 예약은 보지 않는다. 이 경로가 예약을 동시에 소진하므로
 * available(=on_hand−reserved) 기반 `AllocationStrategyService` 를 쓰면 이중 차감된다.
 */
export interface OnHandLedgerRow {
  locationId: string;
  qty: number;
  fifoRank: number | null;
  updatedAt: Date;
}

export interface AllocationChunk {
  locationId: string;
  qty: number;
}

export function fifoAllocate(rows: OnHandLedgerRow[], quantity: number): AllocationChunk[] {
  const chunks: AllocationChunk[] = [];
  let remaining = quantity;

  const ordered = [...rows].sort((a, b) => {
    if (a.fifoRank !== b.fifoRank) {
      if (a.fifoRank === null) return 1; // nulls last
      if (b.fifoRank === null) return -1;
      return a.fifoRank - b.fifoRank;
    }
    return a.updatedAt.getTime() - b.updatedAt.getTime(); // 오래된 것 먼저
  });

  for (const r of ordered) {
    if (remaining <= 0) break;
    const take = Math.min(r.qty, remaining);
    if (take > 0) {
      chunks.push({ locationId: r.locationId, qty: take });
      remaining -= take;
    }
  }

  if (remaining > 0) {
    throw new Error(`FIFO 소진 실패: ON_HAND 부족 (요청 ${quantity}, ${remaining} 부족)`);
  }

  return chunks;
}
