export const REQUIRED_PERMISSIONS = [
  'fulfillment.shipment.read',
  'fulfillment.warehouse.operate',
  'fulfillment.dispatch.force',
] as const;

/** 한국어 문장 목록. 빈 배열 = 통과. */
export function preflightProblems(input: { permissions: string[]; supportedPickingStrategies: string[] }): string[] {
  const problems: string[] = REQUIRED_PERMISSIONS.filter((p) => !input.permissions.includes(p)).map(
    (p) => `권한이 없다: ${p} — 이 계정에 부여해야 한다`,
  );
  if (!input.supportedPickingStrategies.includes('discrete')) {
    problems.push('이 창고는 낱개 피킹(discrete)을 지원하지 않는다 — 비상 출고는 낱개 피킹 창고에서만 쓴다');
  }
  return problems;
}
