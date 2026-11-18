import {
  badgeKindOf,
  shipmentPhaseLabel,
  type ShipmentPhase,
} from '@/lib/api/domains/orders/shipment-phase.shape';
import { cn } from '@/lib/utils/ui';
import type { OrderLineRow } from '../hooks/use-order-rows';

const PHASE_BADGE_CLASS: Record<ShipmentPhase, string> = {
  preparing: 'bg-blue-100 text-blue-700',
  shipping: 'bg-sky-100 text-sky-700',
  delivered: 'bg-green-100 text-green-700',
  external_shipped: 'bg-teal-100 text-teal-700',
  cancelled: 'bg-gray-100 text-gray-500',
};

type BadgeRow = Pick<OrderLineRow, 'shipmentPhase' | 'isMatched'>;

/** 목록이 배지를 그리는 주문인지. 그리지 않는 주문(단계를 모름)은 다른 화면에서 «-» 로 쓴다. */
export function hasStatusBadge({
  shipmentPhase,
  isMatched,
}: BadgeRow): boolean {
  const kind = badgeKindOf(shipmentPhase, isMatched);
  return kind === 'unmatched' || (kind === 'phase' && shipmentPhase !== null);
}

export function StatusBadge({ row }: { row: BadgeRow }) {
  const { shipmentPhase, isMatched } = row;
  const kind = badgeKindOf(shipmentPhase, isMatched);
  if (kind === 'unmatched')
    return (
      <span className="inline-flex rounded-full bg-orange-100 text-orange-600 text-[11px] font-medium px-2 py-0.5 whitespace-nowrap">
        매칭 대기
      </span>
    );
  if (kind === 'none' || shipmentPhase === null) return null;
  return (
    <span
      className={cn(
        'inline-flex rounded-full text-[11px] font-medium px-2 py-0.5 whitespace-nowrap',
        PHASE_BADGE_CLASS[shipmentPhase]
      )}
    >
      {shipmentPhaseLabel(shipmentPhase)}
    </span>
  );
}
