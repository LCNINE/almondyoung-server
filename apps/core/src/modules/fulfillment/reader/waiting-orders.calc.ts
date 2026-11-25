export interface DemandLine {
  orderKey: string;
  /** 상자 줄 수량 */
  qty: number;
  /** 그 줄에 걸린 확정 예약 */
  reservedQty: number;
  /** 시작한 배치가 이미 잡아 둔 몫 */
  startedQty: number;
  /** 우리가 내보낼 상자인가. 아니면 새로 풀린 재고를 기다리는 줄에만 서고 세지 않는다 */
  counted: boolean;
}

export interface StockBudget {
  /** 배치를 시작하면 바로 배정할 수 있는 수량 */
  pickableQty: number;
  /** 아무 상자도 예약하지 않은 수량 */
  unreservedQty: number;
}

export interface WaitingTotal {
  orders: number;
  qty: number;
}

/**
 * 지금 집을 수 있는 재고로 나가지 못하는 몫. `lines` 는 재고 대기 순번대로 온다.
 * 예약이 잡힌 몫은 집을 수 있는 재고로 나가고, 예약이 없는 몫은 그 나머지 중 아무도 예약하지 않은 재고로만 나간다.
 */
export function waitingTotal(lines: readonly DemandLine[], budget: StockBudget): WaitingTotal {
  let left = Math.max(0, budget.pickableQty);
  const take = (wanted: number) => {
    const taken = Math.min(wanted, left);
    left -= taken;
    return taken;
  };
  const open = lines.map((line) => {
    const qty = Math.max(0, line.qty - line.startedQty);
    const reserved = Math.min(qty, Math.max(0, line.reservedQty - line.startedQty));
    return { line, qty, reserved, covered: 0 };
  });

  for (const row of open) if (row.line.counted) row.covered += take(row.reserved);
  left = Math.min(left, Math.max(0, budget.unreservedQty));
  for (const row of open) row.covered += take(row.qty - row.reserved);

  const orders = new Set<string>();
  let qty = 0;
  for (const row of open) {
    const waiting = row.qty - row.covered;
    if (!row.line.counted || waiting === 0) continue;
    orders.add(row.line.orderKey);
    qty += waiting;
  }
  return { orders: orders.size, qty };
}
