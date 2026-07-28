import type { RoleScopeMappingDefinition, ScopeDefinition } from '@app/authorization';

export const INVENTORY_SCOPE = {
  WAREHOUSE_MANAGE: 'inventory.warehouse.manage',
} as const;

export type InventoryScope = (typeof INVENTORY_SCOPE)[keyof typeof INVENTORY_SCOPE];

export const INVENTORY_SCOPES: ScopeDefinition[] = [
  {
    key: INVENTORY_SCOPE.WAREHOUSE_MANAGE,
    category: 'inventory',
    description: '창고 생성·수정·삭제 및 피킹 방식 설정',
  },
];

/**
 * `admin` 을 포함하는 이유: 이 스코프를 쓰는 유일한 화면
 * (`admin-web` 의 `/inventory/warehouses`)이 `requireRole={['admin','master']}` 로
 * 들여보낸다. `logistics_manager` 만 매핑하면 master 없는 admin 사용자가 화면에는
 * 들어가고 저장에서 403 을 받는다.
 *
 * `logistics_worker` 는 의도적으로 제외한다 — 창고 생성·삭제는 현장 작업이 아니다.
 */
export const INVENTORY_ROLE_MAPPINGS: RoleScopeMappingDefinition[] = [
  { roleName: 'admin', scopeKeys: [INVENTORY_SCOPE.WAREHOUSE_MANAGE] },
  { roleName: 'logistics_manager', scopeKeys: [INVENTORY_SCOPE.WAREHOUSE_MANAGE] },
];
