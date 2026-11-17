import { Link } from '@tanstack/react-router';
import { isStationDevice } from '../../app/station';
import { useWarehouse } from '../../app/warehouse-context';
import { errorMessage } from '../../core/data/errorMessage';
import { ScreenHeader } from '../../core/design/ScreenHeader';
import { WarehousePicker } from '../warehouse/WarehousePicker';
import { useExpectedArrivals } from './queries';
import type { InboundShipmentArrival } from './types';

function formatDate(iso: string | null): string {
  if (!iso) return '예정일 미정';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '예정일 미정';
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function localDateString(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** 기기 로컬 날짜 문자열 비교 — 예정일(YYYY-MM-DD)이 오늘보다 이르면 지남. */
function isPastDate(iso: string | null): boolean {
  if (!iso) return false;
  return iso.slice(0, 10) < localDateString(new Date());
}

function ShipmentRow({
  arrival,
  station,
}: {
  arrival: InboundShipmentArrival;
  station: boolean;
}) {
  const date = isPastDate(arrival.expectedDate)
    ? '예정일 지남'
    : formatDate(arrival.expectedDate);
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-gray-800">
          {arrival.name}
        </span>
        <span className="block text-xs text-gray-500">
          {date} · 상자 {arrival.receivedBoxes}/{arrival.stockBoxes}
        </span>
      </span>
      <span className="shrink-0 rounded-full bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">
        남은 {arrival.totalOutstandingQuantity}
      </span>
    </>
  );
  if (station) {
    return (
      <Link
        to="/inbound/boxes"
        className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-3 active:bg-gray-50"
      >
        {body}
      </Link>
    );
  }
  return (
    <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
      {body}
      <span className="shrink-0 text-xs text-gray-500">스테이션 작업</span>
    </div>
  );
}

export function ExpectedArrivalListScreen() {
  const { warehouseId, isSet } = useWarehouse();
  const arrivals = useExpectedArrivals(warehouseId);

  if (!isSet) {
    return (
      <div className="space-y-4">
        <ScreenHeader title="입고" backTo="/" />
        <div className="space-y-3 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4">
          <p className="text-sm text-gray-600">창고를 먼저 선택해 주세요.</p>
          <WarehousePicker />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ScreenHeader title="입고" backTo="/" />

      <Link
        to="/inbound/quick"
        className="block rounded-lg border border-blue-300 bg-blue-50 p-3 text-center text-sm font-semibold text-blue-700"
      >
        간편입고
      </Link>

      <Link
        to="/inbound/history"
        className="block rounded-lg border p-3 text-center"
      >
        입고내역 · 취소
      </Link>
      {isStationDevice() && (
        <Link
          to="/inbound/boxes"
          className="block rounded-lg border p-3 text-center"
        >
          선적 상자 입고
        </Link>
      )}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-gray-700">입고 예정</h2>
        {arrivals.isError ? (
          <p role="alert" className="text-sm text-red-600">
            {errorMessage(arrivals.error, 'inbound')}
          </p>
        ) : arrivals.isLoading ? (
          <p className="text-sm text-gray-500">불러오는 중…</p>
        ) : (arrivals.data?.arrivals ?? []).length === 0 ? (
          <p className="text-sm text-gray-500">입고 예정이 없어요.</p>
        ) : (
          <ul className="space-y-2">
            {(arrivals.data?.arrivals ?? []).map((arrival) =>
              arrival.source === 'inbound_shipment' ? (
                <li key={`shipment:${arrival.documentId}`}>
                  <ShipmentRow arrival={arrival} station={isStationDevice()} />
                </li>
              ) : (
                <li key={arrival.documentId}>
                  <Link
                    to="/inbound/purchase-orders/$poId"
                    params={{ poId: arrival.documentId }}
                    className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-3 active:bg-gray-50"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-gray-800">
                        {arrival.supplier?.name ?? '발주처 미상'}
                      </span>
                      <span className="block text-xs text-gray-500">
                        {formatDate(arrival.expectedDate)} ·{' '}
                        {arrival.lines.length}품목
                      </span>
                    </span>
                    <span className="shrink-0 rounded-full bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">
                      남은 {arrival.totalOutstandingQuantity}
                    </span>
                  </Link>
                </li>
              )
            )}
          </ul>
        )}
      </section>
    </div>
  );
}
