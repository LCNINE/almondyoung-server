/**
 * 다른 화면(정체 보드)이 주문 하나를 지목해 주문내역으로 보낼 때 쓰는 쿼리. `?orderNo=` 는 «주문번호» 지목 검색이 되어
 * 기간·구분 필터를 타지 않는다(build-query.ts 의 isOrderNoLookup). 데모의 `externalOrderId` 는 옛 동작 그대로.
 */
export function pointedOrderNo(
  params: { get(name: string): string | null },
  isDemo: boolean
): string | null {
  const raw =
    params.get('orderNo') ?? (isDemo ? params.get('externalOrderId') : null);
  const trimmed = raw?.trim();
  return trimmed ? trimmed : null;
}
