import { isSplitQtyAllowed } from '@/lib/api/domains/orders/order-progress.shape';
import type { ShipmentAdminLine } from '@/lib/types/dto/fulfillment';

/** 고객이 아는 주문번호. 표시 번호가 없으면 채널 주문 번호를 쓴다. */
export function lineOrderNo(line: ShipmentAdminLine): string | null {
  return line.origin?.displayOrderNo ?? line.origin?.channelOrderId ?? null;
}

/** 상품명(옵션). 이름을 싣지 않는 응답이면 SKU 앞자리 */
export function splitLineName(line: ShipmentAdminLine): string {
  return line.skuName ?? `SKU ${line.skuId.slice(0, 8)}`;
}

/** 나눌 상품 선택지 이름: 상품명(옵션) · 주문번호 · 지금 수량 */
export function splitLineLabel(line: ShipmentAdminLine): string {
  const orderNo = lineOrderNo(line);
  return [splitLineName(line), orderNo ? `#${orderNo}` : null, `${line.qty}개`]
    .filter(Boolean)
    .join(' · ');
}

export type SplitPreview = {
  /** 고른 줄에서 이번 상자에 남는 수량 */
  lineStays: number;
  /** 새 상자로 보내는 수량 */
  moves: number;
  /** 나눈 뒤 이번 상자 전체 수량 */
  boxStays: number;
};

/** 입력이 서버 규칙(1 이상, 줄 수량 이하, 상자가 비지 않음)에 맞을 때만 나눈 뒤 수량을 준다. */
export function splitPreview(
  line: ShipmentAdminLine | undefined,
  input: string,
  lines: ShipmentAdminLine[]
): SplitPreview | null {
  if (!line || !/^\d+$/.test(input.trim())) return null;
  const moves = Number(input);
  const boxTotal = lines.reduce((sum, entry) => sum + entry.qty, 0);
  if (!isSplitQtyAllowed(moves, line.qty, boxTotal)) return null;
  return { lineStays: line.qty - moves, moves, boxStays: boxTotal - moves };
}
