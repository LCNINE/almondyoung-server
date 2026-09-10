/**
 * 고객이 보는 주문번호로 만든다.
 *
 * 자사몰(Medusa)은 `20260910-3900` — 주문일(KST) + `display_id`. 고객 주문상세와 주문 알림에는
 * 날짜와 `#3900` 이 따로 찍히지만, 운영에서 주문을 부르는 표기(셀메이트 주문번호도 이 형식이다)는
 * 둘을 붙인 쪽이라 관리자 화면도 그것에 맞춘다.
 *
 * 채널이 고객 주문번호를 따로 주지 않는 외부채널(네이버·쿠팡)은 **채널 주문번호가 곧 고객
 * 주문번호**라 그대로 쓴다 — 없는 번호를 지어내지 않는다.
 *
 * 날짜는 런타임 시간대에 기대지 않고 `Asia/Seoul` 을 명시한다. 서버(ECS)·CI 는 UTC 로 뜨고
 * 브라우저 시간대도 관리자마다 다를 수 있는데, 주문번호가 렌더 위치에 따라 달라지면 안 된다.
 */
const KST_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function formatCustomerOrderNo(
  displayOrderNo: string | null | undefined,
  orderDate: string | Date | null | undefined,
  channelOrderId: string
): string {
  if (!displayOrderNo) return channelOrderId;
  const day = kstYyyymmdd(orderDate);
  return day ? `${day}-${displayOrderNo}` : displayOrderNo;
}

function kstYyyymmdd(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const at = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(at.getTime())) return null;
  // en-CA 는 YYYY-MM-DD 로 내려온다 — 하이픈만 걷어낸다.
  return KST_DAY.format(at).replace(/-/g, '');
}
