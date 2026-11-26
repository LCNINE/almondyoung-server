import { WorkArea } from '../../core/operations/WorkBoundary';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useWarehouse } from '../../app/warehouse-context';
import { useWorkPermissions } from '../../core/operations/useWorkCapabilities';
import {
  errorMessage,
  STOCK_ADJUST_PERMISSION_MESSAGE,
} from '../../core/data/errorMessage';
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

function AdjustStockScreenContent({
  skuId,
  initialLocationId,
  mode = 'adjust',
}: {
  skuId: string;
  initialLocationId?: string;
  mode?: 'adjust' | 'manufacture';
}) {
  const navigate = useNavigate();
  const { warehouseId, isSet } = useWarehouse();
  const detail = useSkuDetail(skuId);
  const stock = useSkuWarehouseStock(skuId, warehouseId);
  const adjust = useAdjustStock();
  const permissions = useWorkPermissions();

  const permissionDenied =
    !permissions.isError && permissions.data?.stockAdjust === false;
  const isManufacture = mode === 'manufacture';
  const title = isManufacture ? '제조 완료 등록' : '재고 조정';
  const backTo = isManufacture ? '/inventory/manufacture' : '/inventory';

  const [locationId, setLocationId] = useState<string | undefined>(
    initialLocationId
  );
  const [term, setTerm] = useState('');
  const [count, setCount] = useState(0);
  const [counted, setCounted] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [otherReason, setOtherReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [autoSelected, setAutoSelected] = useState(false);
  const [previous, setPrevious] = useState<{ id: string; auto: boolean } | null>(null);
  const [result, setResult] = useState<{
    productName: string;
    locationCode: string;
    before: number;
    after: number;
  } | null>(null);

  const autoSelectionChecked = useRef(false);

  useEffect(() => {
    if (
      !isManufacture ||
      initialLocationId !== undefined ||
      autoSelectionChecked.current ||
      !stock.data
    ) {
      return;
    }

    autoSelectionChecked.current = true;

    const locationIds = new Set(
      stock.data.details
        .filter((row) => row.stockState === 'ON_HAND')
        .map((row) => row.locationId)
    );

    if (!locationId && locationIds.size === 1) {
      setLocationId(locationIds.values().next().value);
      setAutoSelected(true);
    }
  }, [isManufacture, initialLocationId, stock.data, locationId]);

  // 실패 시엔 재시도를 위해 같은 키를 유지하고, 성공 후에만 새로 발급한다.
  // findEventIdByIdempotencyKey 가 sku·location·delta 와 무관하게 키만으로
  // 전역 중복제거를 하므로, 같은 마운트에서의 다음 제출이 이전 성공 키를
  // 재사용하면 백엔드가 조용히 no-op 한다 — 화면은 성공을 보여주는데 재고는
  // 안 움직인다. 이동(navigate)에 기대지 않고 여기서 구조적으로 막는다.
  const [idempotencyKey, setIdempotencyKey] = useState(() =>
    crypto.randomUUID()
  );

  const search = useLocationSearch(warehouseId, term);

  // 스캔한 로케이션 코드는 검색으로 해석한다(코드 → id 경로가 이것뿐이다).
  useScanner((e) => {
    if (!adjust.isPending) setTerm(e.code);
  });

  const rows = stock.data?.details ?? [];
  const selected = useMemo(() => {
    if (!locationId) return null;
    const fromStock = rows.find((r) => r.locationId === locationId);
    if (fromStock) return { id: locationId, code: fromStock.locationName || fromStock.locationCode };
    const fromSearch = search.data?.items.find((i) => i.id === locationId);
    return fromSearch
      ? { id: fromSearch.id, code: fromSearch.displayName || fromSearch.code }
      : { id: locationId, code: locationId };
  }, [locationId, rows, search.data]);

  const currentOnHand = useMemo(
    () =>
      rows
        .filter(
          (r) => r.locationId === locationId && r.stockState === 'ON_HAND'
        )
        .reduce((sum, r) => sum + r.quantity, 0),
    [rows, locationId]
  );

  // 조정은 맞출 수량을 받아 화면의 현재 ON_HAND 와의 차이를 보낸다. 제조는 만든 수량 그대로다.
  // ponytail: 화면을 연 뒤 다른 작업이 같은 칸 재고를 움직이면 맞춘 값이 그만큼 어긋난다. 서버가 목표 수량을 받게 되면 거기로 옮긴다.
  const delta = isManufacture ? count : counted ? count - currentOnHand : 0;

  const effectiveReason = isManufacture
    ? '제조'
    : reason === OTHER
      ? otherReason.trim()
      : (reason ?? '');
  const canSubmit =
    !permissionDenied &&
    isSet &&
    Boolean(warehouseId) &&
    Boolean(locationId) &&
    stock.data !== undefined &&
    (isManufacture ? delta > 0 : delta !== 0) &&
    effectiveReason.length > 0;

  // 키가 어떤 payload 에 묶여 있는지 추적한다. "요청은 커밋됐는데 응답만
  // 유실"된 뒤 작업자가 delta·로케이션을 고쳐 재제출하면, 키가 그대로면
  // 백엔드가 이걸 이전 요청의 replay 로 보고 성공을 돌려주면서 실제로는
  // 옛(틀린) 금액을 적용한다 — payload 가 바뀌면 키를 회전시켜 막는다. 바뀌지
  // 않은 채 재시도하는 것(진짜 재시도)은 여전히 같은 키를 재사용해야 한다.
  const keyPayloadRef = useRef({
    skuId,
    locationId,
    delta,
    reason: effectiveReason,
  });
  useEffect(() => {
    const prev = keyPayloadRef.current;
    const next = { skuId, locationId, delta, reason: effectiveReason };
    const changed =
      prev.skuId !== next.skuId ||
      prev.locationId !== next.locationId ||
      prev.delta !== next.delta ||
      prev.reason !== next.reason;
    if (!changed) return;
    keyPayloadRef.current = next;
    setIdempotencyKey(crypto.randomUUID());
  }, [skuId, locationId, delta, effectiveReason]);

  if (!isSet) {
    return (
      <div className="space-y-4">
        <ScreenHeader title={title} backTo={backTo} />
        <div className="space-y-3 rounded-xl border border-dashed border-[#e4e4e7] bg-white p-4">
          <p className="text-sm text-[#52525b]">창고를 먼저 선택해 주세요.</p>
          <WarehousePicker />
        </div>
      </div>
    );
  }

  if (result) {
    return (
      <div className="space-y-5">
        <ScreenHeader title={title} backTo={backTo} />
        <h2 className="text-lg font-bold text-[#27272a]">
          제조 완료를 등록했어요
        </h2>
        <div className="space-y-2 rounded-xl border border-[#e4e4e7] bg-white p-5">
          <p className="font-semibold text-[#27272a]">{result.productName}</p>
          <p>{result.locationCode}</p>
          <p className="text-lg font-semibold">
            {result.before} → {result.after}
          </p>
          <p>사유 제조</p>
        </div>
        <Button
          type="button"
          className="w-full py-3"
          onClick={() => navigate({ to: '/inventory/manufacture' })}
        >
          다음 상품 등록
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <ScreenHeader title={title} backTo={backTo} />

      {permissionDenied && (
        <p role="alert" className="text-sm text-[#aa4037]">
          {STOCK_ADJUST_PERMISSION_MESSAGE}
        </p>
      )}

      {detail.data ? (
        <div className="rounded-xl border border-[#e4e4e7] bg-white px-5 py-4">
          <div className="font-semibold text-[#27272a]">{detail.data.name}</div>
          <div className="font-mono text-xs text-[#71717a]">
            {detail.data.code}
          </div>
        </div>
      ) : null}

      <section className="space-y-3 rounded-xl border border-[#e4e4e7] bg-white p-5">
        <h2 className="text-[13px] font-bold text-[#27272a]">로케이션</h2>
        {selected ? (
          <div className="flex items-center gap-3 rounded-xl border border-[#2563eb] bg-[#eff6ff] px-4 py-3">
            <span className="flex-1 font-medium text-[#27272a]">
              {selected.code}
            </span>
            <span className="text-xs text-[#71717a]">현재 ON_HAND</span>
            <span
              data-testid="current-onhand"
              className="text-lg font-bold text-[#27272a]"
            >
              {currentOnHand}
            </span>
            <button
              type="button"
              className="text-xs text-[#2563eb] underline"
              onClick={() => {
                autoSelectionChecked.current = true;
                setPrevious({ id: selected.id, auto: autoSelected });
                setAutoSelected(false);
                setLocationId(undefined);
              }}
            >
              변경
            </button>
          </div>
        ) : (
          <>
            <label htmlFor="loc-search" className="sr-only">
              로케이션 검색
            </label>
            <div className="flex gap-2">
              <input
                id="loc-search"
                aria-label="로케이션 검색"
                className="min-w-0 flex-1 rounded-lg border border-[#e4e4e7] bg-white px-3 py-2.5 text-sm text-[#27272a]"
                placeholder="로케이션 바코드를 스캔하거나 코드를 입력하세요"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
              />
              {previous && (
                <Button
                  type="button"
                  onClick={() => {
                    setLocationId(previous.id);
                    setAutoSelected(previous.auto);
                    setPrevious(null);
                    setTerm('');
                  }}
                >
                  취소
                </Button>
              )}
            </div>
            {search.isError ? (
              <p role="alert" className="text-sm text-[#aa4037]">
                {errorMessage(search.error, 'location')}
              </p>
            ) : null}
            {search.isPlaceholderData ? (
              // 창고를 바꾸면 새 요청이 도는 동안 이전 창고의 결과가 placeholder 로 남는다.
              // 그 행을 그대로 보여주면 다른 창고의 locationId 를 고를 수 있어 렌더를 막는다.
              <p className="text-sm text-[#71717a]">불러오는 중…</p>
            ) : (
              <ul className="space-y-1">
                {(search.data?.items ?? []).map((loc) => (
                  <li key={loc.id}>
                    <button
                      type="button"
                      className="w-full rounded-xl border border-[#e4e4e7] bg-white px-4 py-3 text-left hover:bg-[#eff6ff]"
                      onClick={() => {
                        setPrevious(null);
                        setLocationId(loc.id);
                      }}
                    >
                      {loc.displayName || loc.code}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        {selected && autoSelected && (
          <p className="text-xs text-[#71717a]">
            재고가 있는 위치가 한 곳이라 먼저 골라 뒀어요.
          </p>
        )}
      </section>

      <section className="space-y-3 rounded-xl border border-[#e4e4e7] bg-white p-5">
        <h2 className="text-[13px] font-bold text-[#27272a]">
          {isManufacture ? '만든 수량' : '맞출 수량'}
        </h2>
        <div
          data-testid="adjust-quantity"
          className={cn(
            'rounded-xl border p-3 text-center text-2xl font-semibold',
            delta > 0 && 'border-[#2f7a3b] bg-[#eef7ef] text-[#2f7a3b]',
            delta < 0 && 'border-[#aa4037] bg-[#fcebe8] text-[#aa4037]',
            delta === 0 && 'border-[#e4e4e7] bg-white text-[#a1a1aa]'
          )}
        >
          {isManufacture ? (delta > 0 ? `+${delta}` : delta) : counted ? count : currentOnHand}
        </div>
        {!isManufacture && counted && (
          <p data-testid="adjust-change" className="text-center text-sm text-[#52525b]">
            {currentOnHand} → {count} ({delta > 0 ? `+${delta}` : delta})
          </p>
        )}
        <NumberPad
          value={count}
          onChange={(next) => {
            setCount(next);
            setCounted(true);
          }}
          keyboard={!confirming && !adjust.isPending}
        />
        <p className="text-xs text-[#71717a]">
          {isManufacture
            ? '늘리기만 할 수 있어요. 줄여야 하면 재고 조회에서 재고 조정을 쓰세요.'
            : '이 위치에 지금 실제로 있는 수량을 그대로 넣으세요.'}
        </p>
      </section>

      {isManufacture ? (
        <p className="text-sm text-[#52525b]">사유 제조</p>
      ) : (
        <section className="space-y-3 rounded-xl border border-[#e4e4e7] bg-white p-5">
          <h2 className="text-[13px] font-bold text-[#27272a]">사유</h2>
          <div className="flex flex-wrap gap-2">
            {ADJUST_REASONS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setReason(r)}
                className={cn(
                  'rounded-full border px-3 py-1.5 text-sm',
                  reason === r
                    ? 'border-[#2563eb] bg-[#eff6ff] text-[#2563eb]'
                    : 'border-[#e4e4e7] bg-white text-[#52525b]'
                )}
              >
                {r}
              </button>
            ))}
          </div>
          {reason === OTHER ? (
            <input
              aria-label="사유 직접 입력"
              className="w-full rounded-lg border border-[#e4e4e7] bg-white px-3 py-2.5 text-sm text-[#27272a]"
              placeholder="사유를 입력하세요"
              value={otherReason}
              onChange={(e) => setOtherReason(e.target.value)}
            />
          ) : null}
        </section>
      )}

      {adjust.isError ? (
        <p role="alert" className="text-sm text-[#aa4037]">
          {errorMessage(adjust.error, 'adjust')}
        </p>
      ) : null}

      <Button
        type="button"
        className="w-full py-3"
        disabled={!canSubmit || adjust.isPending}
        onClick={() => setConfirming(true)}
      >
        {isManufacture ? '제조 완료 등록' : '조정하기'}
      </Button>

      <ConfirmDialog
        open={confirming}
        title={isManufacture ? '제조 완료를 등록할까요?' : '재고 조정'}
        message={
          isManufacture
            ? `${detail.data?.name ?? '상품'} · ${selected?.code ?? ''} · +${delta} (${currentOnHand} → ${currentOnHand + delta}) · 사유 제조`
            : `${selected?.code ?? ''} 의 ${detail.data?.name ?? '상품'} 을(를) ${currentOnHand} → ${currentOnHand + delta}개로 맞춥니다(${
                delta > 0 ? `+${delta}` : delta
              }). 사유: ${effectiveReason}`
        }
        confirmLabel={isManufacture ? '등록' : '조정'}
        danger={!isManufacture && delta < 0}
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);

          if (!canSubmit || !warehouseId || !locationId) {
            return;
          }

          const submittedResult = {
            productName: detail.data?.name ?? '상품',
            locationCode: selected?.code ?? locationId,
            before: currentOnHand,
            after: currentOnHand + delta,
          };

          adjust.mutate(
            {
              skuId,
              warehouseId,
              locationId,
              delta,
              reason: effectiveReason,
              idempotencyKey,
              summary: `${submittedResult.productName} ${delta > 0 ? '+' : ''}${delta}개`,
            },
            {
              onSuccess: () => {
                // 성공했을 때만 회전한다 — 실패 후 재시도는 같은 키를 재사용해야 한다.
                setIdempotencyKey(crypto.randomUUID());

                if (isManufacture) {
                  setResult(submittedResult);
                } else {
                  navigate({ to: '/inventory/$sku', params: { sku: skuId } });
                }
              },
            }
          );
        }}
      />
    </div>
  );
}

export function AdjustStockScreen(
  props: Parameters<typeof AdjustStockScreenContent>[0]
) {
  return (
    <WorkArea kind="adjust">
      <AdjustStockScreenContent {...props} />
    </WorkArea>
  );
}
