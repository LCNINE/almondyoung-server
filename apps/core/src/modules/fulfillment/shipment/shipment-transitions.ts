import type { shipmentStatusEnum } from '../../inventory/schema/inventory.schema';

export type ShipmentStatus = (typeof shipmentStatusEnum.enumValues)[number];

export const RECOVERY_CODES = ['CANCEL_REPLAN_PENDING', 'CONSOLIDATION_PENDING', 'DISPATCH_RECALL_PENDING'] as const;
export type RecoveryCode = (typeof RECOVERY_CODES)[number];

export interface TransitionRule {
  from: ShipmentStatus;
  to: ShipmentStatus;
  /** from 이 recovery_required 일 때 허용 코드 */
  fromCodes?: readonly RecoveryCode[];
  /** to 가 recovery_required 일 때 허용 코드 */
  toCodes?: readonly RecoveryCode[];
  /** 'supplier' 면 입점사 상자 전용 — transitionShipments 가 CAS 에 supplier_id IS NOT NULL 을 더한다 */
  owner?: 'supplier';
}

/** 상자 상태 전이표(설계 §5.1). failed·canceled·superseded·delivered 에서 나가는 행은 없다. */
export const SHIPMENT_TRANSITIONS: readonly TransitionRule[] = [
  { from: 'draft', to: 'planned' },
  { from: 'draft', to: 'recovery_required', toCodes: ['CANCEL_REPLAN_PENDING', 'CONSOLIDATION_PENDING'] },
  { from: 'planned', to: 'recovery_required', toCodes: ['CANCEL_REPLAN_PENDING', 'CONSOLIDATION_PENDING'] },
  { from: 'shipped', to: 'recovery_required', toCodes: ['DISPATCH_RECALL_PENDING'] },
  { from: 'planned', to: 'draft' },
  { from: 'recovery_required', to: 'draft', fromCodes: ['CANCEL_REPLAN_PENDING', 'DISPATCH_RECALL_PENDING'] },
  { from: 'draft', to: 'canceled' },
  { from: 'draft', to: 'superseded' },
  { from: 'planned', to: 'superseded' },
  { from: 'recovery_required', to: 'superseded', fromCodes: ['CONSOLIDATION_PENDING'] },
  { from: 'planned', to: 'shipped' },
  /** 입점사 상자는 계획·피킹을 거치지 않고 시트 올리기로 바로 발송된다(K3 PR5). 창고 상자에는 CAS 가 0행이다. */
  { from: 'draft', to: 'shipped', owner: 'supplier' },
  { from: 'shipped', to: 'in_transit' },
  { from: 'shipped', to: 'delivered' },
  { from: 'in_transit', to: 'delivered' },
];

/** 표에 없으면 Error(프로그래밍 오류). */
export function assertLegalTransition(
  from: ShipmentStatus,
  to: ShipmentStatus,
  codes: { fromCode?: RecoveryCode; toCode?: RecoveryCode },
): void {
  const { fromCode, toCode } = codes;
  const legal = SHIPMENT_TRANSITIONS.some(
    (r) =>
      r.from === from &&
      r.to === to &&
      (!r.fromCodes || (fromCode !== undefined && r.fromCodes.includes(fromCode))) &&
      (!r.toCodes || (toCode !== undefined && r.toCodes.includes(toCode))),
  );
  if (!legal) {
    throw new Error(`Illegal shipment transition: ${from}(${fromCode ?? '-'}) -> ${to}(${toCode ?? '-'})`);
  }
}

/** 이 쌍에 맞는 행이 입점사 전용이면 true (코드 조건까지 맞는 행 기준). */
export function isSupplierOnlyTransition(from: ShipmentStatus, to: ShipmentStatus): boolean {
  return SHIPMENT_TRANSITIONS.some((r) => r.from === from && r.to === to && r.owner === 'supplier');
}

export interface TransitionEffect {
  /** now 로 채울 칼럼 */
  stamp: 'plannedAt' | 'shippedAt' | 'deliveredAt' | 'supersededAt' | null;
  clears: ReadonlyArray<'recoveryCode' | 'plannedAt' | 'shippedAt' | 'deliveredAt'>;
  bumpsManifest: boolean;
  /** 줄의 inspected_qty>0 OR forced 를 지우고 그 줄만 lineVersion+1 (D1) */
  resetsInspection: boolean;
}

const NONE: TransitionEffect = { stamp: null, clears: [], bumpsManifest: false, resetsInspection: false };

export function transitionEffect(to: ShipmentStatus): TransitionEffect {
  switch (to) {
    case 'draft':
      return {
        stamp: null,
        clears: ['recoveryCode', 'plannedAt', 'shippedAt', 'deliveredAt'],
        bumpsManifest: true,
        resetsInspection: true,
      };
    case 'planned':
      return { ...NONE, stamp: 'plannedAt' };
    case 'shipped':
      return { ...NONE, stamp: 'shippedAt' };
    case 'delivered':
      return { ...NONE, stamp: 'deliveredAt' };
    case 'canceled':
      return { ...NONE, bumpsManifest: true };
    case 'superseded':
      return { ...NONE, stamp: 'supersededAt', clears: ['recoveryCode'], bumpsManifest: true };
    default:
      return NONE;
  }
}
