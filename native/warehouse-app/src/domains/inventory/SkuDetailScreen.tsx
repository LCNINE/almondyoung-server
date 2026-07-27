import { Link } from '@tanstack/react-router';
import { useWarehouse } from '../../app/warehouse-context';
import { errorMessage } from '../../core/data/errorMessage';
import { Button } from '../../core/design/Button';
import { ScreenHeader } from '../../core/design/ScreenHeader';
import { WarehousePicker } from '../warehouse/WarehousePicker';
import { useSkuDetail, useSkuStockSummary, useSkuWarehouseStock } from './useSkuDetail';
import type { StockDetailRow } from './types';

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
  const { warehouseId, isSet } = useWarehouse();
  const detail = useSkuDetail(skuId);
  const summary = useSkuStockSummary(skuId);
  const warehouseStock = useSkuWarehouseStock(skuId, warehouseId);

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

  return (
    <div className="space-y-5">
      <ScreenHeader title={sku ? sku.name : '상품 재고 상세'} backTo="/inventory" />

      {sku ? (
        <div className="text-sm text-gray-600">
          <span className="font-mono">{sku.code}</span>
          {sku.optionKey ? <span className="ml-2 text-gray-500">{sku.optionKey}</span> : null}
        </div>
      ) : null}

      {summary.data ? (
        <div className="grid grid-cols-3 gap-2">
          <StatCard label="실재고" value={summary.data.totalRealQuantity} testId="total-real" />
          <StatCard label="예약" value={summary.data.totalReservedQuantity} testId="total-reserved" />
          <StatCard label="가용" value={summary.data.totalAvailableQuantity} testId="total-available" />
        </div>
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
                  <span className="block font-medium text-gray-800">{row.locationCode}</span>
                  <span className="block text-xs text-gray-500">{row.stockState}</span>
                </span>
                <span className="text-lg font-semibold text-gray-900">{row.quantity}</span>
                <Link
                  to="/inventory/$sku/adjust"
                  params={{ sku: skuId }}
                  search={{ locationId: row.locationId }}
                >
                  <Button className="px-3 py-1.5 text-xs">조정</Button>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {isSet ? (
        <Link to="/inventory/$sku/adjust" params={{ sku: skuId }}>
          <Button className="w-full py-3">재고 조정</Button>
        </Link>
      ) : null}
    </div>
  );
}
