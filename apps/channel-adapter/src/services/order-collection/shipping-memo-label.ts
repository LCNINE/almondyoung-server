/**
 * Medusa order.metadata 의 배송메모를 한진 송장에 실을 사람이 읽는 문구로 바꾼다.
 *
 * 공동현관 비밀번호는 여기 섞지 않는다 — deliveryNote 는 sales_orders.shipping_address /
 * shipments.recipient_snapshot jsonb 로 영구 복사되고 합배송 그룹핑 키에도 들어간다.
 * 비번은 별도 슬롯으로 흐르며 송장 조립 시점에만 합성된다.
 */
const MEMO_LABELS: Record<string, string> = {
  door: '문 앞에 놓아주세요',
  security: '경비실에 맡겨주세요',
  'parcel-box': '택배함에 넣어주세요',
  direct: '직접 받겠습니다',
};

export function buildDeliveryNote(
  metadata: Record<string, unknown> | null | undefined,
): string | undefined {
  const type = metadata?.shipping_memo_type;
  if (typeof type !== 'string' || !type) return undefined;

  if (type === 'other') {
    const custom = metadata?.shipping_memo_custom;
    return typeof custom === 'string' && custom.trim() ? custom.trim() : undefined;
  }

  return MEMO_LABELS[type];
}
