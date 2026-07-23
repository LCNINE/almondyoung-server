import { useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useWarehouse } from '../../app/warehouse-context';
import { errorMessage } from '../../core/data/errorMessage';
import { Button } from '../../core/design/Button';
import { ScreenHeader } from '../../core/design/ScreenHeader';
import { NumberPad } from '../../core/design/NumberPad';
import { ConfirmDialog } from '../../core/design/ConfirmDialog';
import { cn } from '../../core/design/cn';
import { useScanner } from '../../core/hardware/scan/useScanner';
import { useLocationSearch } from '../warehouse/useLocationSearch';
import { WarehousePicker } from '../warehouse/WarehousePicker';
import { useSkuDetail, useSkuWarehouseStock } from './useSkuDetail';
import { useAdjustStock, ADJUST_REASONS } from './useAdjustStock';

const OTHER = '기타';

export function AdjustStockScreen({
  skuId,
  initialLocationId,
}: {
  skuId: string;
  initialLocationId?: string;
}) {
  const navigate = useNavigate();
  const { warehouseId, isSet } = useWarehouse();
  const detail = useSkuDetail(skuId);
  const stock = useSkuWarehouseStock(skuId, warehouseId);
  const adjust = useAdjustStock();

  const [locationId, setLocationId] = useState<string | undefined>(initialLocationId);
  const [term, setTerm] = useState('');
  const [delta, setDelta] = useState(0);
  const [reason, setReason] = useState<string | null>(null);
  const [otherReason, setOtherReason] = useState('');
  const [confirming, setConfirming] = useState(false);

  // 실패 시엔 재시도를 위해 같은 키를 유지하고, 성공 후에만 새로 발급한다.
  // findEventIdByIdempotencyKey 가 sku·location·delta 와 무관하게 키만으로
  // 전역 중복제거를 하므로, 같은 마운트에서의 다음 제출이 이전 성공 키를
  // 재사용하면 백엔드가 조용히 no-op 한다 — 화면은 성공을 보여주는데 재고는
  // 안 움직인다. 이동(navigate)에 기대지 않고 여기서 구조적으로 막는다.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  const search = useLocationSearch(warehouseId, term);

  // 스캔한 로케이션 코드는 검색으로 해석한다(코드 → id 경로가 이것뿐이다).
  useScanner((e) => setTerm(e.code));

  const rows = stock.data?.details ?? [];
  const selected = useMemo(() => {
    if (!locationId) return null;
    const fromStock = rows.find((r) => r.locationId === locationId);
    if (fromStock) return { id: locationId, code: fromStock.locationCode };
    const fromSearch = search.data?.items.find((i) => i.id === locationId);
    return fromSearch ? { id: fromSearch.id, code: fromSearch.code } : { id: locationId, code: locationId };
  }, [locationId, rows, search.data]);

  const currentOnHand = useMemo(
    () =>
      rows
        .filter((r) => r.locationId === locationId && r.stockState === 'ON_HAND')
        .reduce((sum, r) => sum + r.quantity, 0),
    [rows, locationId]
  );

  const effectiveReason = reason === OTHER ? otherReason.trim() : (reason ?? '');
  const canSubmit =
    isSet && Boolean(warehouseId) && Boolean(locationId) && delta !== 0 && effectiveReason.length > 0;

  if (!isSet) {
    return (
      <div className="space-y-4">
        <ScreenHeader title="재고 조정" backTo="/inventory" />
        <div className="space-y-3 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4">
          <p className="text-sm text-gray-600">창고를 먼저 선택해 주세요.</p>
          <WarehousePicker />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <ScreenHeader title="재고 조정" backTo="/inventory" />

      {detail.data ? (
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <div className="font-semibold text-gray-800">{detail.data.name}</div>
          <div className="font-mono text-xs text-gray-500">{detail.data.code}</div>
        </div>
      ) : null}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-gray-700">로케이션</h2>
        {selected ? (
          <div className="flex items-center gap-3 rounded-lg border border-blue-500 bg-blue-50 p-3">
            <span className="flex-1 font-medium text-gray-800">{selected.code}</span>
            <span className="text-xs text-gray-500">현재 ON_HAND</span>
            <span data-testid="current-onhand" className="text-lg font-semibold text-gray-900">
              {currentOnHand}
            </span>
            <button
              type="button"
              className="text-xs text-blue-700 underline"
              onClick={() => setLocationId(undefined)}
            >
              변경
            </button>
          </div>
        ) : (
          <>
            <label htmlFor="loc-search" className="sr-only">
              로케이션 검색
            </label>
            <input
              id="loc-search"
              aria-label="로케이션 검색"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              placeholder="로케이션 바코드를 스캔하거나 코드를 입력하세요"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
            />
            {search.isError ? (
              <p role="alert" className="text-sm text-red-600">
                {errorMessage(search.error, 'location')}
              </p>
            ) : null}
            {search.isPlaceholderData ? (
              // 창고를 바꾸면 새 요청이 도는 동안 이전 창고의 결과가 placeholder 로 남는다.
              // 그 행을 그대로 보여주면 다른 창고의 locationId 를 고를 수 있어 렌더를 막는다.
              <p className="text-sm text-gray-500">불러오는 중…</p>
            ) : (
              <ul className="space-y-1">
                {(search.data?.items ?? []).map((loc) => (
                  <li key={loc.id}>
                    <button
                      type="button"
                      className="w-full rounded-md border border-gray-200 bg-white p-3 text-left active:bg-gray-50"
                      onClick={() => setLocationId(loc.id)}
                    >
                      {loc.code}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-gray-700">조정 수량</h2>
        <div
          className={cn(
            'rounded-lg border p-3 text-center text-2xl font-semibold',
            delta > 0 && 'border-green-500 bg-green-50 text-green-700',
            delta < 0 && 'border-red-500 bg-red-50 text-red-700',
            delta === 0 && 'border-gray-200 bg-white text-gray-400'
          )}
        >
          {delta > 0 ? `+${delta}` : delta}
        </div>
        <NumberPad value={delta} onChange={setDelta} allowNegative />
        <p className="text-xs text-gray-500">
          파손·분실은 −, 발견은 +. 실제 수량을 그대로 맞추려면 실사를 쓰세요.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-gray-700">사유</h2>
        <div className="flex flex-wrap gap-2">
          {ADJUST_REASONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setReason(r)}
              className={cn(
                'rounded-full border px-3 py-1.5 text-sm',
                reason === r ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-300 bg-white text-gray-700'
              )}
            >
              {r}
            </button>
          ))}
        </div>
        {reason === OTHER ? (
          <input
            aria-label="사유 직접 입력"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            placeholder="사유를 입력하세요"
            value={otherReason}
            onChange={(e) => setOtherReason(e.target.value)}
          />
        ) : null}
      </section>

      {adjust.isError ? (
        <p role="alert" className="text-sm text-red-600">
          {errorMessage(adjust.error)}
        </p>
      ) : null}

      <Button
        type="button"
        className="w-full py-3"
        disabled={!canSubmit || adjust.isPending}
        onClick={() => setConfirming(true)}
      >
        조정하기
      </Button>

      <ConfirmDialog
        open={confirming}
        title="재고 조정"
        message={`${selected?.code ?? ''} 의 ${detail.data?.name ?? '상품'} 을(를) ${
          delta > 0 ? `+${delta}` : delta
        } 조정합니다. 사유: ${effectiveReason}`}
        confirmLabel="조정"
        danger={delta < 0}
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          if (!warehouseId || !locationId) return;
          adjust.mutate(
            { skuId, warehouseId, locationId, delta, reason: effectiveReason, idempotencyKey },
            {
              onSuccess: () => {
                // 성공했을 때만 회전한다 — 실패 후 재시도는 같은 키를 재사용해야 한다.
                setIdempotencyKey(crypto.randomUUID());
                navigate({ to: '/inventory/$sku', params: { sku: skuId } });
              },
            }
          );
        }}
      />
    </div>
  );
}
