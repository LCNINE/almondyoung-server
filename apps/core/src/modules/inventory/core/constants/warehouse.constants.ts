import { warehouseTypeEnum } from '../../schema/inventory.schema';

/**
 * 예전 부팅 훅이 만들던 껍데기 창고 두 개의 id. 부팅은 더는 창고를 만들지 않지만(새 테넌트 DB 에
 * 아몬드영 창고가 생기던 길이었다) 라이브 테넌트 1 에는 이 행들이 남아 있어, 삭제 금지 가드만 이 id 를 본다.
 */
export const WAREHOUSE_CONSTANTS = {
  DEFAULT_DOMESTIC_WAREHOUSE: { id: '00000000-0000-0000-0000-000000000001' },
  DEFAULT_OVERSEAS_WAREHOUSE: { id: '00000000-0000-0000-0000-000000000002' },
} as const;

export type WarehouseType = (typeof warehouseTypeEnum.enumValues)[number];

export const SYSTEM_LOCATION_ROLES = {
  INBOUND_DEFAULT: 'inbound_default',
  RETURN_DEFAULT: 'return_default',
  OUTBOUND_REWORK: 'outbound_rework',
  TRANSIT_OUT: 'transit_out',
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
  // 창고간 이동으로 창고를 떠난 재고가 도착 확인 전까지 머무는 존.
  // stock_ledgers.location_id 가 NOT NULL 이라 IN_TRANSFER 잔량도 어딘가 매달려야 하는데,
  // 출발 선반에 두면 떠난 선반이 안 비어 보여 적치·재고조사가 틀어진다.
  [SYSTEM_LOCATION_ROLES.TRANSIT_OUT]: {
    code: 'zone-transit-out',
    displayName: '운송중존',
  },
};
