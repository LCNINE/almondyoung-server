import { warehouseTypeEnum } from '../../schema/inventory.schema';

export const WAREHOUSE_CONSTANTS = {
  // 기본 창고들
  DEFAULT_DOMESTIC_WAREHOUSE: {
    id: '00000000-0000-0000-0000-000000000001',
    name: '국내 메인 창고',
    location: '부천시',
    type: 'domestic' as const,
  },
  DEFAULT_OVERSEAS_WAREHOUSE: {
    id: '00000000-0000-0000-0000-000000000002',
    name: '해외 메인 창고',
    location: '중국',
    type: 'overseas' as const,
  },
} as const;

export type WarehouseType = (typeof warehouseTypeEnum.enumValues)[number];

export const SYSTEM_LOCATION_ROLES = {
  INBOUND_DEFAULT: 'inbound_default',
  RETURN_DEFAULT: 'return_default',
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
};
