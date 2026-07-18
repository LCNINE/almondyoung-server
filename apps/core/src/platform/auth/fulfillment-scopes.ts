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
} as const;

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
];

const LOGISTICS_MANAGER_SCOPE_KEYS = FULFILLMENT_SCOPES.map((scope) => scope.key).filter(
  (scope) => scope !== FULFILLMENT_SCOPE.TRACKING_INGEST,
);

export const FULFILLMENT_ROLE_MAPPINGS: RoleScopeMappingDefinition[] = [
  {
    roleName: 'logistics_worker',
    scopeKeys: [FULFILLMENT_SCOPE.WAREHOUSE_OPERATE],
  },
  {
    roleName: 'logistics_manager',
    scopeKeys: LOGISTICS_MANAGER_SCOPE_KEYS,
  },
];
