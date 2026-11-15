import { Link } from '@tanstack/react-router';
import { useWarehouse } from '../../app/warehouse-context';
import { useWorkPermissions } from '../../core/operations/useWorkCapabilities';
import { errorMessage, STOCK_ADJUST_PERMISSION_MESSAGE } from '../../core/data/errorMessage';
import { Button } from '../../core/design/Button';
import { ScreenHeader } from '../../core/design/ScreenHeader';
import { WarehousePicker } from '../warehouse/WarehousePicker';
import { useSkuDetail, useSkuStockSummary, useSkuWarehouseStock } from './useSkuDetail';
import type { SkuStockSummary, StockDetailRow } from './types';

type WarehouseStock = SkuStockSummary['warehouseStocks'][number];

function hasStock(w: WarehouseStock) {
  return w.realQuantity !== 0 || w.reservedQuantity !== 0 || w.availableQuantity !== 0;
}

function StatCard({ label, value, testId }: { label: string; value: number; testId: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 text-center">
      <div className="text-xs text-gray-500">{label}</div>
      <div data-testid={testId} className="text-lg font-semibold text-gray-900">
        {value}
      </div>
    </div>
  );
}

export function SkuDetailScreen({ skuId }: { skuId: string }) {
  const { warehouseId, warehouseName, isSet } = useWarehouse();
  const detail = useSkuDetail(skuId);
  const summary = useSkuStockSummary(skuId);
  const warehouseStock = useSkuWarehouseStock(skuId, warehouseId);
  const permissions = useWorkPermissions();

  const permissionDenied = !permissions.isError && permissions.data?.stockAdjust === false;

  if (detail.isError) {
    return (
      <div className="space-y-4">
        <ScreenHeader title="상품 재고 상세" backTo="/inventory" />
        <p role="alert" className="text-sm text-red-600">
          {errorMessage(detail.error)}
        </p>
      </div>
    );
  }

  const sku = detail.data;
  // quantity 0 행은 현장에 의미가 없다 — 백엔드는 행 집합을 줄이지 않으므로 여기서 거른다.
  const rows: StockDetailRow[] = (warehouseStock.data?.details ?? []).filter((d) => d.quantity !== 0);

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
    <div className="space-y-5">
      <ScreenHeader title={sku ? sku.name : '상품 재고 상세'} backTo="/inventory" />

      {sku ? (
        <div className="text-sm text-gray-600">
          <span className="font-mono">{sku.code}</span>
          {sku.optionKey ? <span className="ml-2 text-gray-500">{sku.optionKey}</span> : null}
        </div>
      ) : null}

      {permissionDenied && (
        <p role="alert" className="text-sm text-red-600">
          {STOCK_ADJUST_PERMISSION_MESSAGE}
        </p>
      )}

      {summary.data && headline ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-gray-700">{headline.title}</h2>
          <div className="grid grid-cols-3 gap-2">
            <StatCard label="실재고" value={headline.real} testId="stock-real" />
            <StatCard label="예약" value={headline.reserved} testId="stock-reserved" />
            <StatCard label="가용" value={headline.available} testId="stock-available" />
          </div>
          {isSet ? (
            others.length === 0 ? (
              <p className="text-xs text-gray-500">다른 창고에는 재고가 없어요.</p>
            ) : (
              <section
                aria-label="다른 창고"
                className="space-y-1 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm"
              >
                <h3 className="text-xs font-semibold text-gray-600">다른 창고</h3>
                <ul className="space-y-1">
                  {others.map((w) => (
                    <li key={w.warehouseId} className="flex flex-wrap items-center justify-between gap-x-2">
                      <span className="text-gray-800">{w.warehouseName}</span>
                      <span className="tabular-nums text-gray-700">
                        {`실재고 ${w.realQuantity} · 예약 ${w.reservedQuantity} · 가용 ${w.availableQuantity}`}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="border-t border-gray-200 pt-1 text-xs tabular-nums text-gray-500">
                  {`전체 창고 합계 실재고 ${summary.data.totalRealQuantity} · 예약 ${summary.data.totalReservedQuantity} · 가용 ${summary.data.totalAvailableQuantity}`}
                </p>
              </section>
            )
          ) : null}
        </section>
      ) : null}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-gray-700">위치별 재고</h2>

        {!isSet ? (
          <div className="space-y-3 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4">
            <p className="text-sm text-gray-600">
              창고를 먼저 선택하면 위치별 재고를 볼 수 있어요.
            </p>
            <WarehousePicker />
          </div>
        ) : warehouseStock.isError ? (
          <p role="alert" className="text-sm text-red-600">
            {errorMessage(warehouseStock.error)}
          </p>
        ) : warehouseStock.isLoading ? (
          <p className="text-sm text-gray-500">불러오는 중…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-gray-500">이 창고에는 재고가 없어요.</p>
        ) : (
          <ul className="space-y-2">
            {rows.map((row) => (
              <li
                key={`${row.locationId}-${row.stockState}`}
                className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-3"
              >
                <span className="flex-1">
                  <span className="block font-medium text-gray-800">{row.locationName || row.locationCode}</span>
                  <span className="block text-xs text-gray-500">{row.stockState}</span>
                </span>
                <span className="text-lg font-semibold text-gray-900">{row.quantity}</span>
                <Link
                  disabled={permissionDenied}
                  to="/inventory/$sku/adjust"
                  params={{ sku: skuId }}
                  search={{ locationId: row.locationId }}
                >
                  <Button disabled={permissionDenied} className="px-3 py-1.5 text-xs">
                    조정
                  </Button>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {isSet ? (
        <Link disabled={permissionDenied} to="/inventory/$sku/adjust" params={{ sku: skuId }}>
          <Button disabled={permissionDenied} className="w-full py-3">
            재고 조정
          </Button>
        </Link>
      ) : null}
    </div>
  );
}
