import { warehouseTypeEnum } from '../../schema/inventory.schema';

export const WAREHOUSE_CONSTANTS = {
  // 기본 창고들
  DEFAULT_DOMESTIC_WAREHOUSE: {
    id: '00000000-0000-0000-0000-000000000001',
    name: '국내 메인 창고',
    location: '부천시',
    type: 'domestic' as const,
    // 이 값이 비면 배치 생성 게이트가 막아 출고에 쓸 수 없는 창고가 된다.
    // discrete(개별 피킹)만 켠다 — 토탈·멀티오더는 창고 설정 화면에서 명시적으로.
    supportedPickingStrategies: ['discrete'] as const,
  },
  DEFAULT_OVERSEAS_WAREHOUSE: {
    id: '00000000-0000-0000-0000-000000000002',
    name: '해외 메인 창고',
    location: '중국',
    type: 'overseas' as const,
    supportedPickingStrategies: ['discrete'] as const,
  },
} as const;

export type WarehouseType = (typeof warehouseTypeEnum.enumValues)[number];

export const SYSTEM_LOCATION_ROLES = {
  INBOUND_DEFAULT: 'inbound_default',
  RETURN_DEFAULT: 'return_default',
  OUTBOUND_REWORK: 'outbound_rework',
} as const;

export const SYSTEM_LOCATION_DEFAULTS: Record<string, { code: string; displayName: string }> = {
  [SYSTEM_LOCATION_ROLES.INBOUND_DEFAULT]: {
    code: 'zone-inbound-default',
    displayName: '입고 기본존',
  },
  [SYSTEM_LOCATION_ROLES.RETURN_DEFAULT]: {
    code: 'zone-return-default',
    displayName: '반품 기본존',
  },
  [SYSTEM_LOCATION_ROLES.OUTBOUND_REWORK]: {
    code: 'zone-outbound-rework',
    displayName: '출고 재작업존',
  },
};
