import { Link } from '@tanstack/react-router';
import { isStationDevice } from '../../app/station';
import { useWarehouse } from '../../app/warehouse-context';
import { errorMessage } from '../../core/data/errorMessage';
import { ScreenHeader } from '../../core/design/ScreenHeader';
import { WarehousePicker } from '../warehouse/WarehousePicker';
import { InboundTabs } from './InboundTabs';
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

const PANEL = 'min-w-0 overflow-hidden rounded-xl border border-[#e4e4e7] bg-white';
const PANEL_HEAD =
  'flex items-center justify-between gap-2.5 border-b border-[#e4e4e7] px-[22px] py-[19px]';
const ROW =
  'flex items-center gap-3 border-b border-[#e4e4e7] py-[18px] last:border-b-0';
const LINK_ROW = `${ROW} hover:bg-[#fafafa]`;
const PILL =
  'inline-flex shrink-0 items-center rounded-[5px] bg-[#eff6ff] px-2 py-[5px] text-xs font-semibold whitespace-nowrap text-[#2563eb]';
const OUTLINE_BUTTON =
  'inline-flex items-center justify-center rounded-lg border border-[#e4e4e7] bg-white px-4 py-[11px] text-sm font-semibold text-[#27272a] hover:bg-[#eff6ff]';
const STATUS = 'px-5 py-[18px] text-[13px] text-[#71717a]';

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
        <strong className="block truncate text-[13px] leading-[1.6] font-semibold">
          {arrival.name}
        </strong>
        <small className="mt-1 block text-xs text-[#71717a]">
          {date} · 상자 {arrival.receivedBoxes}/{arrival.stockBoxes}
        </small>
      </span>
      <span className={PILL}>남은 {arrival.totalOutstandingQuantity}</span>
    </>
  );

  if (station) {
    return (
      <Link to="/inbound/boxes" className={LINK_ROW}>
        {body}
      </Link>
    );
  }

  return (
    <div className={ROW}>
      {body}
      <span className="shrink-0 text-xs text-[#71717a]">스테이션 작업</span>
    </div>
  );
}

export function ExpectedArrivalListScreen() {
  const { warehouseId, isSet } = useWarehouse();
  const arrivals = useExpectedArrivals(warehouseId);
  const station = isStationDevice();
  const header = (
    <ScreenHeader
      title="발주 입고"
      backTo="/"
      description="입고 예정인 발주와 선적을 골라 받으세요."
      right={<InboundTabs active="orders" />}
    />
  );

  if (!isSet) {
    return (
      <div className="space-y-[22px]">
        {header}
        <div className={`${PANEL} space-y-3 p-[22px]`}>
          <p className="text-[13px] text-[#71717a]">창고를 먼저 선택해 주세요.</p>
          <WarehousePicker />
        </div>
      </div>
    );
  }

  const list = arrivals.data?.arrivals ?? [];

  return (
    <div className="space-y-[22px]">
      {header}

      {station && (
        <Link to="/inbound/boxes" className={OUTLINE_BUTTON}>
          선적 상자 입고
        </Link>
      )}

      <section className={PANEL}>
        <div className={PANEL_HEAD}>
          <h2 className="text-[15px] font-semibold">입고 예정</h2>
          {list.length > 0 ? (
            <span className="rounded-[5px] bg-[#eff6ff] px-[7px] py-1 text-xs text-[#2563eb]">
              {list.length}건
            </span>
          ) : null}
        </div>
        {arrivals.isError ? (
          <p role="alert" className={`${STATUS} text-[#aa4037]`}>
            {errorMessage(arrivals.error, 'inbound')}
          </p>
        ) : arrivals.isLoading ? (
          <p className={STATUS}>불러오는 중…</p>
        ) : list.length === 0 ? (
          <p className={STATUS}>입고 예정이 없어요.</p>
        ) : (
          <ul className="px-5">
            {list.map((arrival) =>
              arrival.source === 'inbound_shipment' ? (
                <li key={`shipment:${arrival.documentId}`}>
                  <ShipmentRow arrival={arrival} station={station} />
                </li>
              ) : (
                <li key={arrival.documentId}>
                  <Link
                    to="/inbound/purchase-orders/$poId"
                    params={{ poId: arrival.documentId }}
                    className={LINK_ROW}
                  >
                    <span className="min-w-0 flex-1">
                      <strong className="block truncate text-[13px] leading-[1.6] font-semibold">
                        {arrival.supplier?.name ?? '발주처 미상'}
                      </strong>
                      <small className="mt-1 block text-xs text-[#71717a]">
                        {formatDate(arrival.expectedDate)} ·{' '}
                        {arrival.lines.length}품목
                      </small>
                    </span>
                    <span className={PILL}>
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
