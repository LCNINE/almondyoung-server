import { RoleScopeMappingDefinition, ScopeDefinition } from '@app/authorization';
import { FULFILLMENT_ROLE_MAPPINGS, FULFILLMENT_SCOPES } from './fulfillment-scopes';
import { INVENTORY_ROLE_MAPPINGS, INVENTORY_SCOPES } from './inventory-scopes';

/**
 * 모든 BC의 스코프를 병합한다.
 * 현재 Catalog scopes: [] (빈 배열).
 * 향후 각 BC에서 스코프가 추가되면 여기서 병합.
 */
export const ALL_SCOPES: ScopeDefinition[] = [
  // Catalog scopes (향후 추가)
  ...INVENTORY_SCOPES,
  ...FULFILLMENT_SCOPES,
];

/**
 * role 이름 기준으로 BC별 매핑을 하나로 합친다.
 *
 * 병합이 선택이 아닌 이유 — `AuthorizationService.ensureRoleScopeMappings` 는
 * (1) 중복 roleName 을 만나면 던지고(authorization.service.ts:97),
 * (2) 넘긴 목록에 없는 매핑 행을 지운다(:127).
 * 즉 이 함수에 넘기는 배열은 "추가분"이 아니라 그 role 의 **전체 목록**이어야 하며,
 * 두 BC 배열을 그냥 spread 하면 logistics_manager 가 두 번 나와 부팅이 죽는다.
 */
function mergeRoleMappings(...groups: RoleScopeMappingDefinition[][]): RoleScopeMappingDefinition[] {
  const scopeKeysByRole = new Map<string, string[]>();

  for (const group of groups) {
    for (const mapping of group) {
      const scopeKeys = scopeKeysByRole.get(mapping.roleName) ?? [];
      for (const scopeKey of mapping.scopeKeys) {
        if (!scopeKeys.includes(scopeKey)) scopeKeys.push(scopeKey);
      }
      scopeKeysByRole.set(mapping.roleName, scopeKeys);
    }
  }

  return [...scopeKeysByRole].map(([roleName, scopeKeys]) => ({ roleName, scopeKeys }));
}

export const ALL_ROLE_MAPPINGS: RoleScopeMappingDefinition[] = mergeRoleMappings(
  FULFILLMENT_ROLE_MAPPINGS,
  INVENTORY_ROLE_MAPPINGS,
);
