/**
 * 운영자가 검색창에 옮겨 적는 «고객 주문번호» 표기를 하나의 번호로 정규화한다.
 *
 * 같은 번호가 화면마다 다르게 찍힌다: 관리자 주문내역은 `20260910-3900`, 고객 주문상세와
 * 주문 알림은 `#3900`, 엑셀/셀메이트는 `3900`. 운영자는 셋 중 아무거나 붙여넣으므로
 * 저장된 값(`sales_orders.display_order_no` = Medusa `display_id`)과 맞추려면
 * 표기를 벗겨내야 한다.
 *
 * 번호로 읽을 수 없으면 `null` — 호출부는 이때 주문번호 조건을 아예 걸지 않는다.
 * 「0 으로 뭉개지 않는다」와 같은 이유로, 못 읽은 것을 빈 문자열로 만들어 전건 매칭시키지 않는다.
 *
 * 날짜 접두(`20260910-`)는 «검증하지 않고 버린다». 운영자가 날짜를 잘못 옮겨 적었다고 해서
 * 존재하는 주문을 0건으로 돌려주는 편이 더 불편하고, 번호만으로 이미 유일하다.
 */
export function extractDisplayOrderNo(keyword: string): string | null {
  const trimmed = keyword.trim();
  if (!trimmed) return null;

  // `20260910-3900` / `20260910_3900` / `20260910 3900` → 뒤쪽 번호
  const dated = /^(\d{8})[-_ ](\d{1,20})$/.exec(trimmed);
  if (dated) return stripLeadingZeros(dated[2]);

  // `#3900` / `3900`
  const bare = /^#?(\d{1,20})$/.exec(trimmed);
  if (bare) return stripLeadingZeros(bare[1]);

  return null;
}

/** `display_id` 는 선행 0 없이 저장된다 — `0390` 을 붙여넣어도 같은 주문을 찾게 한다. */
function stripLeadingZeros(digits: string): string {
  const stripped = digits.replace(/^0+/, '');
  return stripped === '' ? '0' : stripped;
}
