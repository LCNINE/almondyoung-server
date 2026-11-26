import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Printer } from 'lucide-react';
import { useWarehouse } from '../../app/warehouse-context';
import { isStationDevice } from '../../app/station';
import { useWorkPermissions } from '../../core/operations/useWorkCapabilities';
import { errorMessage, STOCK_ADJUST_PERMISSION_MESSAGE } from '../../core/data/errorMessage';
import { Button } from '../../core/design/Button';
import { SkuLabelPrintPanel } from '../labels/SkuLabelPrintPanel';
import { WarehousePicker } from '../warehouse/WarehousePicker';
import { SkuThumbnail } from './SkuInfoSheet';
import { StockHistoryPanel, stockStateLabel } from './StockHistoryPanel';
import {
  useSkuDetail,
  useSkuStockSummary,
  useSkuWarehouseStock,
  useSystemLocations,
} from './useSkuDetail';
import type { SkuSearchItem, SkuStockSummary, StockDetailRow } from './types';

type WarehouseStock = SkuStockSummary['warehouseStocks'][number];

export const SECONDARY_BUTTON =
  'border border-[#e4e4e7] bg-white text-[#27272a] hover:bg-[#eff6ff] hover:brightness-100';

const SMALL_BUTTON =
  'inline-flex items-center justify-center whitespace-nowrap rounded-lg border border-[#e4e4e7] bg-white px-2.5 py-[7px] text-xs font-semibold text-[#27272a] hover:bg-[#eff6ff] disabled:pointer-events-none disabled:opacity-40';

function hasStock(w: WarehouseStock) {
  return w.realQuantity !== 0 || w.reservedQuantity !== 0 || w.availableQuantity !== 0;
}

function Stat({
  label,
  value,
  testId,
  accent,
}: {
  label: string;
  value: number;
  testId: string;
  accent?: boolean;
}) {
  return (
    <div>
      <strong
        data-testid={testId}
        className={`block text-2xl font-bold tracking-[-0.8px] tabular-nums ${accent ? 'text-[#2563eb]' : 'text-[#27272a]'}`}
      >
        {value}
      </strong>
      <span className="mt-[5px] block text-[11px] text-[#71717a]">{label}</span>
    </div>
  );
}

export function SkuStockCard({
  skuId,
  item,
  labelOpen,
  onToggleLabel,
}: {
  skuId: string;
  item?: SkuSearchItem;
  labelOpen: boolean;
  onToggleLabel: () => void;
}) {
  const { warehouseId, warehouseName, isSet } = useWarehouse();
  const detail = useSkuDetail(skuId);
  const summary = useSkuStockSummary(skuId);
  const warehouseStock = useSkuWarehouseStock(skuId, warehouseId);
  const permissions = useWorkPermissions();
  const systemLocations = useSystemLocations(warehouseId);
  const station = isStationDevice();
  const [historyOpen, setHistoryOpen] = useState(false);

  const permissionDenied = !permissions.isError && permissions.data?.stockAdjust === false;

  const sku = detail.data;
  const name = sku?.name ?? item?.name;
  const code = sku?.code ?? item?.code;
  const optionKey = sku ? sku.optionKey : item?.optionKey;
  const imageFileIds = sku?.imageFileIds ?? item?.imageFileIds;

  // quantity 0 행은 현장에 의미가 없다 — 백엔드는 행 집합을 줄이지 않으므로 여기서 거른다.
  const rows: StockDetailRow[] = (warehouseStock.data?.details ?? []).filter((d) => d.quantity !== 0);
  const inboundZoneIds = new Set(
    (systemLocations.data?.items ?? [])
      .filter((location) => location.systemRole === 'inbound_default')
      .map((location) => location.id)
  );
  const locationNames = new Map<string, string>([
    ...(systemLocations.data?.items ?? []).map((l): [string, string] => [l.id, l.displayName || l.code]),
    ...(warehouseStock.data?.details ?? []).map((d): [string, string] => [d.locationId, d.locationName || d.locationCode]),
  ]);
  const locationKind = (row: StockDetailRow) => {
    const place = inboundZoneIds.has(row.locationId) ? '적치 대기' : '보관 위치';

    return row.stockState === 'ON_HAND' ? place : `${place} · ${stockStateLabel(row.stockState)}`;
  };

  // 상단 숫자는 고른 창고 기준이다. 창고별 값과 합계를 한 응답에서 읽어 서로 어긋나지 않게 한다.
  const stocks = summary.data?.warehouseStocks ?? [];
  const here = stocks.find((w) => w.warehouseId === warehouseId);
  const others = stocks.filter((w) => w.warehouseId !== warehouseId && hasStock(w));
  const headline = summary.data
    ? isSet
      ? {
          title: `${here?.warehouseName ?? warehouseName ?? '선택한 창고'} 재고`,
          real: here?.realQuantity ?? 0,
          reserved: here?.reservedQuantity ?? 0,
          available: here?.availableQuantity ?? 0,
        }
      : {
          title: '전체 창고 합계',
          real: summary.data.totalRealQuantity,
          reserved: summary.data.totalReservedQuantity,
          available: summary.data.totalAvailableQuantity,
        }
    : null;

  return (
    <aside
      aria-label="상품 재고"
      className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-[#e4e4e7] bg-white"
    >
      {detail.isError ? (
        <p role="alert" className="border-b border-[#e4e4e7] px-[22px] py-4 text-sm text-[#aa4037]">
          {errorMessage(detail.error)}
        </p>
      ) : null}

      <div className="border-b border-[#e4e4e7] p-[25px] text-center max-[900px]:p-[18px]">
        <SkuThumbnail
          fileIds={imageFileIds}
          className="mx-auto mb-[18px] h-[124px] w-[108px] rounded-xl"
        />
        {name ? (
          <h2 className="text-xl leading-normal font-bold tracking-[-0.6px] text-[#27272a]">{name}</h2>
        ) : null}
        {optionKey ? <p className="mt-1.5 text-xs text-[#71717a]">{optionKey}</p> : null}
        {code ? <p className="mt-1.5 font-mono text-xs text-[#71717a]">{code}</p> : null}

        {headline && summary.data ? (
          <section className="mt-[22px]">
            <h3 className="text-xs font-semibold text-[#71717a]">{headline.title}</h3>
            <div className="mt-2.5 grid grid-cols-3 gap-[5px]">
              <Stat label="전체 재고" value={headline.real} testId="stock-real" />
              <Stat label="가용 수량" value={headline.available} testId="stock-available" accent />
              <Stat label="예약 수량" value={headline.reserved} testId="stock-reserved" />
            </div>
            {isSet ? (
              others.length === 0 ? (
                <p className="mt-3 text-xs text-[#71717a]">다른 창고에는 재고가 없어요.</p>
              ) : (
                <section
                  aria-label="다른 창고"
                  className="mt-3 space-y-1 rounded-lg border border-[#e4e4e7] bg-[#fafafa] p-3 text-left text-sm"
                >
                  <h4 className="text-xs font-semibold text-[#71717a]">다른 창고</h4>
                  <ul className="space-y-1">
                    {others.map((w) => (
                      <li key={w.warehouseId} className="flex flex-wrap items-center justify-between gap-x-2">
                        <span className="text-[#27272a]">{w.warehouseName}</span>
                        <span className="text-[#52525b] tabular-nums">
                          {`실재고 ${w.realQuantity} · 예약 ${w.reservedQuantity} · 가용 ${w.availableQuantity}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="border-t border-[#e4e4e7] pt-1 text-xs text-[#71717a] tabular-nums">
                    {`전체 창고 합계 실재고 ${summary.data.totalRealQuantity} · 예약 ${summary.data.totalReservedQuantity} · 가용 ${summary.data.totalAvailableQuantity}`}
                  </p>
                </section>
              )
            ) : null}
          </section>
        ) : null}
      </div>

      {permissionDenied && (
        <p role="alert" className="border-b border-[#e4e4e7] px-[22px] py-3 text-sm text-[#aa4037]">
          {STOCK_ADJUST_PERMISSION_MESSAGE}
        </p>
      )}

      <section className="px-[22px] py-5 max-[900px]:px-5 max-[900px]:py-3.5">
        <h3 className="mb-[9px] text-[13px] font-bold text-[#27272a]">위치별 재고</h3>

        {!isSet ? (
          <div className="space-y-3 rounded-xl border border-dashed border-[#e4e4e7] bg-[#fafafa] p-4">
            <p className="text-sm text-[#52525b]">창고를 먼저 선택하면 위치별 재고를 볼 수 있어요.</p>
            <WarehousePicker />
          </div>
        ) : warehouseStock.isError ? (
          <p role="alert" className="text-sm text-[#aa4037]">
            {errorMessage(warehouseStock.error)}
          </p>
        ) : warehouseStock.isLoading ? (
          <p className="text-sm text-[#71717a]">불러오는 중…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-[#71717a]">이 창고에는 재고가 없어요.</p>
        ) : (
          <ul className="divide-y divide-[#e4e4e7]">
            {rows.map((row) => (
              <li
                key={`${row.locationId}-${row.stockState}`}
                className="flex items-center gap-3 py-3 text-[13px]"
              >
                <span className="min-w-0 flex-1">
                  <strong className="block font-semibold text-[#27272a]">
                    {row.locationName || row.locationCode}
                  </strong>
                  <small className="mt-1 block text-xs text-[#71717a]">{locationKind(row)}</small>
                </span>
                <strong className="font-semibold text-[#27272a] tabular-nums">{`${row.quantity}개`}</strong>
                <Link
                  disabled={permissionDenied}
                  to="/inventory/$sku/adjust"
                  params={{ sku: skuId }}
                  search={{ locationId: row.locationId }}
                >
                  <Button disabled={permissionDenied} className={SMALL_BUTTON}>
                    조정
                  </Button>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {station && labelOpen && sku ? (
        <div className="border-t border-[#e4e4e7] px-[22px] py-4">
          <SkuLabelPrintPanel skuId={skuId} />
        </div>
      ) : null}

      {historyOpen && isSet && warehouseId ? (
        <div className="border-t border-[#e4e4e7] px-[22px] py-4">
          <StockHistoryPanel skuId={skuId} warehouseId={warehouseId} locationNames={locationNames} />
        </div>
      ) : null}

      {station || isSet ? (
        <div className="mt-auto flex flex-wrap gap-2 border-t border-[#e4e4e7] px-[22px] py-[18px] max-[900px]:px-[18px] max-[900px]:py-3">
          {station ? (
            <Button
              type="button"
              aria-expanded={labelOpen}
              className="flex-1 gap-2"
              disabled={!sku}
              onClick={onToggleLabel}
            >
              <Printer className="h-5 w-5" aria-hidden />
              SKU 라벨
            </Button>
          ) : null}
          {isSet ? (
            <Button
              type="button"
              aria-expanded={historyOpen}
              className={`flex-1 ${SECONDARY_BUTTON}`}
              onClick={() => setHistoryOpen((open) => !open)}
            >
              수불 이력
            </Button>
          ) : null}
          {isSet ? (
            <Link
              disabled={permissionDenied}
              to="/inventory/$sku/adjust"
              params={{ sku: skuId }}
              className="flex flex-1"
            >
              <Button
                disabled={permissionDenied}
                className={`w-full ${station ? SECONDARY_BUTTON : ''}`}
              >
                재고 조정
              </Button>
            </Link>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}
