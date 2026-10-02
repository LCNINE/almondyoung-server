import type { RoleScopeMappingDefinition, ScopeDefinition } from '@app/authorization';

export const FULFILLMENT_SCOPE = {
  WAREHOUSE_OPERATE: 'fulfillment.warehouse.operate',
  SHIPMENT_CONSOLIDATE: 'fulfillment.shipment.consolidate',
  SHIPMENT_OVERRIDE_RECIPIENT: 'fulfillment.shipment.override_recipient',
  RESERVATION_TRANSFER: 'fulfillment.reservation.transfer',
  DISPATCH_FORCE: 'fulfillment.dispatch.force',
  DISPATCH_RECALL: 'fulfillment.dispatch.recall',
  SHIPMENT_REOPEN: 'fulfillment.shipment.reopen',
  TRACKING_INGEST: 'fulfillment.tracking.ingest',
  SHIPMENT_SHORT_PICK: 'fulfillment.shipment.short_pick',
  DISPATCH_STATION_FORCE: 'fulfillment.dispatch.station_force',
} as const;

/** 결품 보고 라우트·서비스·작업 권한 미리보기가 공유하는 «하나라도» 집합. */
export const SHORT_PICK_REPORT_SCOPES = [
  FULFILLMENT_SCOPE.SHIPMENT_REOPEN,
  FULFILLMENT_SCOPE.SHIPMENT_SHORT_PICK,
] as const;

/** 단순출고 강제완료 라우트·판정 헬퍼·작업 권한 미리보기가 공유하는 «하나라도» 집합. */
export const SIMPLE_OUTBOUND_FORCE_SCOPES = [
  FULFILLMENT_SCOPE.DISPATCH_FORCE,
  FULFILLMENT_SCOPE.DISPATCH_STATION_FORCE,
] as const;

export type FulfillmentScope = (typeof FULFILLMENT_SCOPE)[keyof typeof FULFILLMENT_SCOPE];

export const FULFILLMENT_SCOPES: ScopeDefinition[] = [
  {
    key: FULFILLMENT_SCOPE.WAREHOUSE_OPERATE,
    category: 'fulfillment',
    description: '일반 shipment 계획, pick, pack, inspect 작업',
  },
  {
    key: FULFILLMENT_SCOPE.SHIPMENT_CONSOLIDATE,
    category: 'fulfillment',
    description: '서로 다른 주문의 shipment 합배송',
  },
  {
    key: FULFILLMENT_SCOPE.SHIPMENT_OVERRIDE_RECIPIENT,
    category: 'fulfillment',
    description: '주문 원본과 다른 수취 정보 확정',
  },
  {
    key: FULFILLMENT_SCOPE.RESERVATION_TRANSFER,
    category: 'fulfillment',
    description: 'shipment line 예약 이전 및 우선순위 변경',
  },
  {
    key: FULFILLMENT_SCOPE.DISPATCH_FORCE,
    category: 'fulfillment',
    description: 'shipment 강제 출고',
  },
  {
    key: FULFILLMENT_SCOPE.DISPATCH_RECALL,
    category: 'fulfillment',
    description: '출고 attempt recall',
  },
  {
    key: FULFILLMENT_SCOPE.SHIPMENT_REOPEN,
    category: 'fulfillment',
    description: '잠긴 shipment 재개방 및 invoice void 연계',
  },
  {
    key: FULFILLMENT_SCOPE.TRACKING_INGEST,
    category: 'fulfillment',
    description: '신뢰된 배송사 tracking event 수신',
  },
  {
    key: FULFILLMENT_SCOPE.SHIPMENT_SHORT_PICK,
    category: 'fulfillment',
    description: '스테이션 결품·파손 보고(다른 위치 재배정 또는 박스 이탈)',
  },
  {
    key: FULFILLMENT_SCOPE.DISPATCH_STATION_FORCE,
    category: 'fulfillment',
    description: '스테이션 강제출고 — 남은 미스캔 수량을 채우고 출고(감사 로그에 이 스코프로 남는다)',
  },
];

const LOGISTICS_MANAGER_SCOPE_KEYS = FULFILLMENT_SCOPES.map((scope) => scope.key).filter(
  (scope) => scope !== FULFILLMENT_SCOPE.TRACKING_INGEST,
);

export const FULFILLMENT_ROLE_MAPPINGS: RoleScopeMappingDefinition[] = [
  {
    roleName: 'logistics_worker',
    scopeKeys: [
      FULFILLMENT_SCOPE.WAREHOUSE_OPERATE,
      FULFILLMENT_SCOPE.SHIPMENT_SHORT_PICK,
      FULFILLMENT_SCOPE.DISPATCH_STATION_FORCE,
    ],
  },
  {
    roleName: 'logistics_manager',
    scopeKeys: LOGISTICS_MANAGER_SCOPE_KEYS,
  },
];
