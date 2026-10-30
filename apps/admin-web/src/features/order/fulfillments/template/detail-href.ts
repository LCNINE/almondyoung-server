// 상자 링크로 들어왔으면 상세에서 그 상자를 바로 열 수 있게 shipmentId 를 넘긴다
export function fulfillmentDetailHref(
  fulfillmentOrderId: string,
  shipmentId?: string
): string {
  const path = `/order/fulfillments/${encodeURIComponent(fulfillmentOrderId)}`;

  if (!shipmentId) {
    return path;
  }

  return `${path}?${new URLSearchParams({ shipmentId }).toString()}`;
}
