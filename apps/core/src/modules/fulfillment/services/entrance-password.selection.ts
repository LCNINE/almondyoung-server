/**
 * 합배송으로 여러 주문이 한 상자가 될 때 송장에 실을 비번을 고른다.
 * 같은 수령인·같은 주소로 묶인 건이므로 현관도 같다고 보고, 값이 갈리면
 * 고객이 중간에 바꾼 것으로 해석해 최신 주문을 따른다.
 */
export function selectEntrancePassword(
  orders: { orderDate: Date; entrancePassword: string | null }[],
): string | null {
  const withPassword = orders.filter((order) => order.entrancePassword);
  if (withPassword.length === 0) return null;

  const latest = withPassword.reduce((newest, candidate) =>
    candidate.orderDate.getTime() > newest.orderDate.getTime() ? candidate : newest,
  );
  return latest.entrancePassword;
}

/** 상자 하나를 대표하는 주문일 = 그 상자가 실은 주문일 중 가장 최근 것. */
function latestOrderDate(orderDates: (Date | null)[]): Date | null {
  const known = orderDates.filter((date): date is Date => date !== null);
  if (known.length === 0) return null;
  return known.reduce((newest, candidate) => (candidate.getTime() > newest.getTime() ? candidate : newest));
}

/**
 * 상자에서 파생된 상자(합배송 대상·분할 대상)가 실을 비번을 고른다.
 *
 * 원본 상자의 비번은 이미 그 상자가 실은 주문 중 최신 것에서 온 값이므로, 상자를 대표하는
 * 주문일도 자기가 실은 주문일 중 최신 것이어야 `selectEntrancePassword` 의 "최신 주문이
 * 이긴다" 규칙이 한 단계 더 파생돼도 유지된다(이미 합배송된 상자를 다시 합배송하는 경우).
 *
 * 주문일을 못 찾는 상자(판매주문에 매달리지 않은 FO 에서 나온 상자)는 상자 생성 시각을 쓴다.
 * 그런 상자에는 애초에 비번이 실릴 경로가 없지만, 순서를 못 정해 조용히 지는 것보다 낫다.
 *
 * 파생된 상자가 비번을 잃으면 그 상자의 송장에 현관 정보가 빠진 채 나가고, 기사가 문을
 * 못 연다 — 분할·합배송이 반드시 이 함수를 거쳐야 하는 이유다.
 */
export function selectEntrancePasswordForMerge(
  sources: { entrancePassword: string | null; createdAt: Date; orderDates: (Date | null)[] }[],
): string | null {
  return selectEntrancePassword(
    sources.map((source) => ({
      orderDate: latestOrderDate(source.orderDates) ?? source.createdAt,
      entrancePassword: source.entrancePassword,
    })),
  );
}
