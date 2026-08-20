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
