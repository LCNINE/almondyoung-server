import { LoadFailure } from '../../core/design/LoadFailure';
import { useSkuStockHistory } from './useSkuDetail';
import type { StockHistoryEvent } from './types';

const TRANSITION_LABELS: Record<string, string> = {
  RECEIVE: '입고',
  SHIP: '출고',
  MOVE: '이동',
  MARK_DEFECT: '불량 지정',
  REWORK_GOOD: '양품 전환',
  SCRAP: '폐기',
  ADJUST_UP: '재고 조정 증가',
  ADJUST_DOWN: '재고 조정 감소',
  RETURN_RECEIVE: '반품 입고',
  RETURN_ACCEPT: '반품 양품',
  RETURN_REJECT: '반품 불량',
};

const STOCK_STATE_LABELS: Record<string, string> = {
  ON_HAND: '정상',
  DEFECTIVE: '불량',
  IN_TRANSFER: '운송 중',
  RETURNED: '반품 검수 대기',
};

export function stockStateLabel(state: string): string {
  return STOCK_STATE_LABELS[state] ?? '기타 상태';
}

function transitionLabel(type: string): string {
  return TRANSITION_LABELS[type] ?? '기타';
}

const TIME_FORMAT = new Intl.DateTimeFormat('ko-KR', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function signedQuantity(event: StockHistoryEvent, warehouseId: string): string {
  const comesIn = event.toWarehouseId === warehouseId && event.toState !== null;
  const goesOut = event.fromWarehouseId === warehouseId && event.fromState !== null;

  if (comesIn && !goesOut) {
    return `+${event.quantity}`;
  }

  if (goesOut && !comesIn) {
    return `-${event.quantity}`;
  }

  return `${event.quantity}`;
}

function locationText(event: StockHistoryEvent, warehouseId: string, names: ReadonlyMap<string, string>) {
  const name = (id: string | null) => (id ? (names.get(id) ?? '다른 위치') : null);
  const from = event.fromWarehouseId === warehouseId ? name(event.fromLocationId) : null;
  const to = event.toWarehouseId === warehouseId ? name(event.toLocationId) : null;

  if (from && to && from !== to) {
    return `${from} → ${to}`;
  }

  return to ?? from ?? '—';
}

export function StockHistoryPanel({
  skuId,
  warehouseId,
  locationNames,
}: {
  skuId: string;
  warehouseId: string;
  locationNames: ReadonlyMap<string, string>;
}) {
  const history = useSkuStockHistory(skuId, warehouseId, true);
  const events = [...(history.data ?? [])].reverse();

  return (
    <section aria-label="수불 이력" className="space-y-2">
      <h3 className="text-[13px] font-bold text-[#27272a]">수불 이력</h3>
      {history.isError ? (
        <LoadFailure
          message="수불 이력을 불러오지 못했어요."
          error={history.error}
          retrying={history.isFetching}
          onRetry={() => void history.refetch()}
        />
      ) : history.isLoading ? (
        <p className="text-sm text-[#71717a]">불러오는 중…</p>
      ) : events.length === 0 ? (
        <p className="text-sm text-[#71717a]">이 창고의 수불 이력이 없어요.</p>
      ) : (
        <ul className="max-h-[320px] divide-y divide-[#e4e4e7] overflow-auto">
          {events.map((event) => (
            <li key={event.id} className="flex items-center gap-3 py-2.5 text-[13px]">
              <time dateTime={event.occurredAt} className="w-[86px] shrink-0 text-xs text-[#71717a] tabular-nums">
                {TIME_FORMAT.format(new Date(event.occurredAt))}
              </time>
              <span className="min-w-0 flex-1">
                <strong className="block font-semibold text-[#27272a]">{transitionLabel(event.transitionType)}</strong>
                <small className="mt-0.5 block truncate text-xs text-[#71717a]">
                  {locationText(event, warehouseId, locationNames)}
                </small>
              </span>
              <strong className="font-semibold text-[#27272a] tabular-nums">{signedQuantity(event, warehouseId)}</strong>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
