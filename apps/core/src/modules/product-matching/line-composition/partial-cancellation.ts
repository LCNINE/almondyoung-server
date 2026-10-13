/**
 * 판매주문 부분 취소(`sales_order_cancellations.metadata.cancelledLines`)를 라인별 취소 수량으로 더한다.
 * 리더와 백필 스크립트가 같이 쓴다 — 유효 수량을 두 군데서 따로 세면 둘의 판정이 갈린다.
 * metadata 는 jsonb 라 형식이 보장되지 않는다. 형식이 아닌 항목은 건너뛴다(옛 FO 생성과 같은 규칙).
 */
export function sumCancelledByLine(metadatas: readonly unknown[]): Map<string, number> {
  const cancelledByLine = new Map<string, number>();
  for (const metadata of metadatas) {
    if (!metadata || typeof metadata !== 'object') continue;
    const lines: unknown = Reflect.get(metadata, 'cancelledLines');
    if (!Array.isArray(lines)) continue;
    for (const line of lines) {
      if (!line || typeof line !== 'object') continue;
      const lineId: unknown = Reflect.get(line, 'salesOrderLineId');
      const quantity: unknown = Reflect.get(line, 'quantity');
      if (typeof lineId !== 'string' || typeof quantity !== 'number') continue;
      cancelledByLine.set(lineId, (cancelledByLine.get(lineId) ?? 0) + quantity);
    }
  }
  return cancelledByLine;
}
