import { useEffect, useRef, useState } from 'react';
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
import { useLocationContents } from './useLocationContents';
import { useMoveStock, MOVE_REASONS } from './useMoveStock';
import type { LocationContentItem } from './types';

const OTHER = '기타';

interface LocationRef {
  id: string;
  code: string;
}

export function MovementScreen() {
  const { warehouseId, isSet } = useWarehouse();

  // (a) 출발지
  const [source, setSource] = useState<LocationRef | null>(null);
  const [sourceTerm, setSourceTerm] = useState('');
  // (c) 품목 이동 시트
  const [activeItem, setActiveItem] = useState<LocationContentItem | null>(null);
  const [dest, setDest] = useState<LocationRef | null>(null);
  const [destTerm, setDestTerm] = useState('');
  const [qty, setQty] = useState(0);
  const [reason, setReason] = useState<string | null>(null);
  const [otherReason, setOtherReason] = useState('');
  const [lastDest, setLastDest] = useState<LocationRef | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  const contents = useLocationContents(source?.id);
  const sourceSearch = useLocationSearch(warehouseId, source ? '' : sourceTerm);
  const destSearch = useLocationSearch(warehouseId, !activeItem || dest ? '' : destTerm);
  const move = useMoveStock();

  // 스캔은 모드에 따라 라우팅된다: 시트가 열려 있고 대상지 미정이면 대상지로,
  // 아니면 출발지 대기 중일 때 출발지로. 내용물 모드(출발지 선택됨·시트 닫힘)의
  // 스캔은 무시한다 — 품목은 탭으로 고른다.
  useScanner((e) => {
    if (activeItem) {
      if (!dest) setDestTerm(e.code);
      return;
    }
    if (!source) setSourceTerm(e.code);
  });

  // 출발지: 스캔/입력이 코드와 정확히 일치하는 단건이면 자동 선택.
  useEffect(() => {
    if (source) return;
    const term = sourceTerm.trim();
    if (!term) return;
    const exact = (sourceSearch.data?.items ?? []).filter((i) => i.code === term);
    if (exact.length === 1) {
      setSource({ id: exact[0].id, code: exact[0].code });
      setSourceTerm('');
    }
  }, [sourceSearch.data, sourceTerm, source]);

  // 대상지: 출발지를 제외한 뒤 코드 완전일치 단건이면 자동 선택.
  useEffect(() => {
    if (!activeItem || dest) return;
    const term = destTerm.trim();
    if (!term) return;
    const exact = (destSearch.data?.items ?? [])
      .filter((i) => i.id !== source?.id)
      .filter((i) => i.code === term);
    if (exact.length === 1) {
      setDest({ id: exact[0].id, code: exact[0].code });
      setDestTerm('');
    }
  }, [destSearch.data, destTerm, activeItem, dest, source]);

  // 멱등키 회전: payload(품목·출발·대상·수량)가 바뀌면 새 키를 발급한다.
  // "요청은 커밋됐는데 응답만 유실" 뒤 값을 고쳐 재제출하면 옛 payload 를
  // 같은 키로 replay 하는 사고를 막는다. 값이 안 바뀐 재시도는 같은 키를 유지.
  const keyPayloadRef = useRef({ skuId: '', from: '', to: '', qty: 0 });
  useEffect(() => {
    if (!activeItem || !source) return;
    const next = { skuId: activeItem.skuId, from: source.id, to: dest?.id ?? '', qty };
    const prev = keyPayloadRef.current;
    if (prev.skuId === next.skuId && prev.from === next.from && prev.to === next.to && prev.qty === next.qty) {
      return;
    }
    keyPayloadRef.current = next;
    setIdempotencyKey(crypto.randomUUID());
  }, [activeItem, source, dest, qty]);

  function openSheet(item: LocationContentItem) {
    if (!source) return;
    setActiveItem(item);
    setDest(null);
    setDestTerm('');
    setQty(item.quantity);
    setReason(null);
    setOtherReason('');
    keyPayloadRef.current = { skuId: item.skuId, from: source.id, to: '', qty: item.quantity };
    setIdempotencyKey(crypto.randomUUID());
  }

  function closeSheet() {
    setActiveItem(null);
    setDest(null);
    setDestTerm('');
    setQty(0);
    setReason(null);
    setOtherReason('');
  }

  const movable = (contents.data?.items ?? []).filter(
    (i) => i.stockState === 'ON_HAND' && i.quantity > 0
  );
  const effectiveReason = reason === OTHER ? otherReason.trim() : reason ?? '';
  const canSubmit =
    Boolean(activeItem) &&
    Boolean(source) &&
    Boolean(dest) &&
    dest?.id !== source?.id &&
    qty >= 1 &&
    qty <= (activeItem?.quantity ?? 0);

  if (!isSet) {
    return (
      <div className="space-y-4">
        <ScreenHeader title="재고 이동" backTo="/" />
        <div className="space-y-3 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4">
          <p className="text-sm text-gray-600">창고를 먼저 선택해 주세요.</p>
          <WarehousePicker />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <ScreenHeader title="재고 이동" backTo="/" />

      {!source ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-gray-700">출발 로케이션</h2>
          <label htmlFor="src-search" className="sr-only">
            출발 로케이션 검색
          </label>
          <input
            id="src-search"
            aria-label="출발 로케이션 검색"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            placeholder="출발 로케이션 바코드를 스캔하거나 코드를 입력하세요"
            value={sourceTerm}
            onChange={(e) => setSourceTerm(e.target.value)}
          />
          {sourceSearch.isError ? (
            <p role="alert" className="text-sm text-red-600">
              {errorMessage(sourceSearch.error, 'location')}
            </p>
          ) : null}
          <ul className="space-y-1">
            {(sourceSearch.data?.items ?? []).map((loc) => (
              <li key={loc.id}>
                <button
                  type="button"
                  className="w-full rounded-md border border-gray-200 bg-white p-3 text-left active:bg-gray-50"
                  onClick={() => {
                    setSource({ id: loc.id, code: loc.code });
                    setSourceTerm('');
                  }}
                >
                  {loc.code}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <>
          <div className="flex items-center gap-3 rounded-lg border border-blue-500 bg-blue-50 p-3">
            <span className="text-xs text-gray-500">출발</span>
            <span className="flex-1 font-medium text-gray-800">{source.code}</span>
            <button
              type="button"
              className="text-xs text-blue-700 underline"
              onClick={() => {
                setSource(null);
                closeSheet();
              }}
            >
              변경
            </button>
          </div>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-gray-700">이동할 품목</h2>
            {contents.isError ? (
              <p role="alert" className="text-sm text-red-600">
                {errorMessage(contents.error, 'location')}
              </p>
            ) : contents.isLoading ? (
              <p className="text-sm text-gray-500">불러오는 중…</p>
            ) : movable.length === 0 ? (
              <p className="text-sm text-gray-500">이 로케이션에는 이동할 재고가 없어요.</p>
            ) : (
              <ul className="space-y-2">
                {movable.map((item) => (
                  <li
                    key={`${item.skuId}-${item.stockState}`}
                    className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-3"
                  >
                    <span className="flex-1">
                      <span className="block font-medium text-gray-800">{item.skuName}</span>
                      <span className="block font-mono text-xs text-gray-500">{item.skuCode}</span>
                    </span>
                    <span className="text-lg font-semibold text-gray-900">{item.quantity}</span>
                    <Button className="px-3 py-1.5 text-xs" onClick={() => openSheet(item)}>
                      이동
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {activeItem && source ? (
        <div
          className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-label="품목 이동"
        >
          <div className="max-h-[90vh] w-full max-w-sm space-y-4 overflow-y-auto rounded-xl bg-white p-5 shadow-lg">
            <div>
              <div className="font-semibold text-gray-800">{activeItem.skuName}</div>
              <div className="font-mono text-xs text-gray-500">{activeItem.skuCode}</div>
              <div className="mt-1 text-xs text-gray-500">
                출발 {source.code} · 현재 ON_HAND {activeItem.quantity}
              </div>
            </div>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-gray-700">이동 수량</h3>
              <div
                className={cn(
                  'rounded-lg border p-2 text-center text-2xl font-semibold',
                  qty >= 1 && qty <= activeItem.quantity
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-200 bg-white text-gray-400'
                )}
              >
                {qty}
              </div>
              <NumberPad value={qty} onChange={setQty} />
              {qty > activeItem.quantity ? (
                <p className="text-xs text-red-600">현재 수량({activeItem.quantity})을 초과할 수 없어요.</p>
              ) : null}
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-gray-700">대상 로케이션</h3>
              {dest ? (
                <div className="flex items-center gap-3 rounded-lg border border-blue-500 bg-blue-50 p-3">
                  <span className="flex-1 font-medium text-gray-800">{dest.code}</span>
                  <button
                    type="button"
                    className="text-xs text-blue-700 underline"
                    onClick={() => setDest(null)}
                  >
                    변경
                  </button>
                </div>
              ) : (
                <>
                  {lastDest && lastDest.id !== source.id ? (
                    <button
                      type="button"
                      className="w-full rounded-md border border-blue-300 bg-blue-50 p-2 text-sm text-blue-700"
                      onClick={() => setDest(lastDest)}
                    >
                      직전 대상지 {lastDest.code} 사용
                    </button>
                  ) : null}
                  <label htmlFor="dest-search" className="sr-only">
                    대상 로케이션 검색
                  </label>
                  <input
                    id="dest-search"
                    aria-label="대상 로케이션 검색"
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    placeholder="대상 로케이션 바코드를 스캔하거나 코드를 입력하세요"
                    value={destTerm}
                    onChange={(e) => setDestTerm(e.target.value)}
                  />
                  {destSearch.isError ? (
                    <p role="alert" className="text-sm text-red-600">
                      {errorMessage(destSearch.error, 'location')}
                    </p>
                  ) : null}
                  <ul className="space-y-1">
                    {(destSearch.data?.items ?? [])
                      .filter((i) => i.id !== source.id)
                      .map((loc) => (
                        <li key={loc.id}>
                          <button
                            type="button"
                            className="w-full rounded-md border border-gray-200 bg-white p-3 text-left active:bg-gray-50"
                            onClick={() => setDest({ id: loc.id, code: loc.code })}
                          >
                            {loc.code}
                          </button>
                        </li>
                      ))}
                  </ul>
                </>
              )}
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-gray-700">
                사유 <span className="text-xs font-normal text-gray-400">(선택)</span>
              </h3>
              <div className="flex flex-wrap gap-2">
                {MOVE_REASONS.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setReason(reason === r ? null : r)}
                    className={cn(
                      'rounded-full border px-3 py-1.5 text-sm',
                      reason === r
                        ? 'border-blue-500 bg-blue-50 text-blue-700'
                        : 'border-gray-300 bg-white text-gray-700'
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

            {move.isError ? (
              <p role="alert" className="text-sm text-red-600">
                {errorMessage(move.error, 'movement')}
              </p>
            ) : null}

            <div className="flex gap-2">
              <Button
                type="button"
                className="flex-1 border border-gray-300 bg-white text-gray-800 hover:bg-gray-50"
                onClick={closeSheet}
              >
                취소
              </Button>
              <Button
                type="button"
                className="flex-1"
                disabled={!canSubmit || move.isPending}
                onClick={() => setConfirming(true)}
              >
                이동하기
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirming}
        title="재고 이동"
        message={`${source?.code ?? ''} → ${dest?.code ?? ''}, ${activeItem?.skuName ?? '상품'} ${qty}개 이동합니다.`}
        confirmLabel="이동"
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          if (!activeItem || !source || !dest || !warehouseId) return;
          move.mutate(
            {
              warehouseId,
              skuId: activeItem.skuId,
              fromLocationId: source.id,
              toLocationId: dest.id,
              quantity: qty,
              reason: effectiveReason || undefined,
              idempotencyKey,
            },
            {
              onSuccess: () => {
                setLastDest(dest);
                setIdempotencyKey(crypto.randomUUID());
                closeSheet();
              },
            }
          );
        }}
      />
    </div>
  );
}
