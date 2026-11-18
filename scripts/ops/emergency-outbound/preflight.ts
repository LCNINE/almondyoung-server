/** 창고 조회(GET inventory/warehouses/:id)에 필요한 권한 — 없으면 창고를 못 읽으니 조회 전에 본다. */
export const WAREHOUSE_READ_PERMISSION = 'inventory.stock.read';

export const REQUIRED_PERMISSIONS = [
  'fulfillment.shipment.read',
  'fulfillment.warehouse.operate',
  'fulfillment.dispatch.force',
  // 사전 점검이 부르는 GET inventory/warehouses/:id (warehouse.controller.ts) 가 요구한다
  WAREHOUSE_READ_PERMISSION,
] as const;

/**
 * 한국어 문장 목록. 빈 배열 = 통과.
 * `supportedPickingStrategies` 가 null 이면 창고를 못 읽은 것(권한 없음) — 그 권한 문제만 보고한다.
 */
export function preflightProblems(input: {
  permissions: string[];
  supportedPickingStrategies: string[] | null;
}): string[] {
  const problems: string[] = REQUIRED_PERMISSIONS.filter((p) => !input.permissions.includes(p)).map(
    (p) => `권한이 없다: ${p} — 이 계정에 부여해야 한다`,
  );
  if (input.supportedPickingStrategies && !input.supportedPickingStrategies.includes('discrete')) {
    problems.push('이 창고는 낱개 피킹(discrete)을 지원하지 않는다 — 비상 출고는 낱개 피킹 창고에서만 쓴다');
  }
  return problems;
}
