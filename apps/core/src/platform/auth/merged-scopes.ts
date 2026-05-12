import { ScopeDefinition } from '@app/authorization';

/**
 * 모든 BC의 스코프를 병합한다.
 * 현재 PIM scopes: [] (빈 배열), WMS scopes: [] (빈 배열)
 * 향후 각 BC에서 스코프가 추가되면 여기서 병합.
 */
export const ALL_SCOPES: ScopeDefinition[] = [
  // Catalog scopes (향후 추가)
  // Inventory scopes (향후 추가)
  // Fulfillment scopes (향후 추가)
];
