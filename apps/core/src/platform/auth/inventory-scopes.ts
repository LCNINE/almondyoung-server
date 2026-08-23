import type { RoleScopeMappingDefinition, ScopeDefinition } from '@app/authorization';

export const INVENTORY_SCOPE = {
  OPERATE: 'inventory.operate',
  MANAGE: 'inventory.manage',
  ADJUST: 'inventory.adjust',
  WAREHOUSE_MANAGE: 'inventory.warehouse.manage',
} as const;

export type InventoryScope = (typeof INVENTORY_SCOPE)[keyof typeof INVENTORY_SCOPE];

export const INVENTORY_SCOPES: ScopeDefinition[] = [
  {
    key: INVENTORY_SCOPE.OPERATE,
    category: 'inventory',
    description: '재고 현장 작업(입고·적치·실사 카운트·이동)과 재고 조회 전반',
  },
  {
    key: INVENTORY_SCOPE.MANAGE,
    category: 'inventory',
    description: 'SKU·로케이션·보관주체·거래처·매입 등 재고 마스터데이터 관리',
  },
  {
    key: INVENTORY_SCOPE.ADJUST,
    category: 'inventory',
    description: '재고 원장 직접 조작 — 수량 조정, 실사 차이 반영, 이전, 반품 처리',
  },
  {
    key: INVENTORY_SCOPE.WAREHOUSE_MANAGE,
    category: 'inventory',
    description: '창고 생성·수정·삭제 및 피킹 방식 설정',
  },
];

const ALL_INVENTORY_SCOPE_KEYS = INVENTORY_SCOPES.map((scope) => scope.key);

/**
 * `admin` 이 전부 받는 이유: inventory 를 쓰는 admin-web 화면 15개가 모두
 * `requireRole={['admin','master']}` 로 들여보낸다. 하나라도 빠지면 화면에는 들어가고
 * 저장에서 403 을 받는다. admin 자체의 권한 축소는 role 재편이 선행돼야 해서 #551 범위 밖이다.
 *
 * `logistics_worker` 가 `OPERATE` 만 받는 이유: 현장 PDA(warehouse-app)의 적치·입고확정·
 * 실사 카운트·이동·조회는 작업자 행위지만, 재고 수량을 직접 고치는 `ADJUST` 와
 * 마스터데이터를 바꾸는 `MANAGE` 는 아니다. 그 결과 PDA 의 재고조정 화면과 실사 차이 반영은
 * `logistics_manager` 를 요구하게 된다 — 오늘도 AdminRealmGuard 가 막고 있으므로 회귀는 아니다.
 */
export const INVENTORY_ROLE_MAPPINGS: RoleScopeMappingDefinition[] = [
  { roleName: 'admin', scopeKeys: ALL_INVENTORY_SCOPE_KEYS },
  { roleName: 'logistics_manager', scopeKeys: ALL_INVENTORY_SCOPE_KEYS },
  { roleName: 'logistics_worker', scopeKeys: [INVENTORY_SCOPE.OPERATE] },
];
