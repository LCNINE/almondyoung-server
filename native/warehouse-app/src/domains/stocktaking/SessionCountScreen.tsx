import { BarcodeInput } from '../../core/hardware/scan/BarcodeInput';
import { useLocationSearch } from '../warehouse/useLocationSearch';
import { AddCountItemSheet } from './AddCountItemSheet';
import { useWorkRuntime } from '../../core/operations/OperationContext';
import { WorkArea } from '../../core/operations/WorkBoundary';
import { useEffect, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { ApiError } from '../../core/data/httpClient';
import { errorMessage } from '../../core/data/errorMessage';
import { Button } from '../../core/design/Button';
import { ScreenHeader } from '../../core/design/ScreenHeader';
import { QuantityInput, parseQuantity } from '../../core/design/QuantityInput';
import { useUnsavedWork } from '../../core/operations/useUnsavedWork';
import { NumberPad } from '../../core/design/NumberPad';
import { cn } from '../../core/design/cn';
import { useScanner } from '../../core/hardware/scan/useScanner';
import {
  SCAN_STORAGE_MESSAGE,
  useWorkScanQueue,
} from '../../core/hardware/scan/useWorkScanQueue';
import { useWorkDraft } from '../../core/operations/useWorkDraft';
import { useStocktakingSession } from './queries';
import {
  useScanLocation,
  useScanProduct,
  useUpdateCount,
  useResetCount,
} from './mutations';
import type {
  ScanLocationItem,
  ScanLocationResult,
  ScanProductResult,
} from './types';

class UnsentCountScanError extends Error {}

interface CountLocationIntent {
  locationCode: string;
  locationId?: string;
}
type CountScan =
  | { kind: 'location'; code: string }
  | { kind: 'product'; code: string; location: CountLocationIntent };

interface EditingLine {
  lineId: string;
  skuName: string;
  value: string;
  revision: number;
}
function SessionCountScreenContent({ sessionId }: { sessionId: string }) {
  const runtime = useWorkRuntime();
  const detail = useStocktakingSession(sessionId);
  const scanLocation = useScanLocation(),
    scanProduct = useScanProduct(),
    updateCount = useUpdateCount(),
    resetCount = useResetCount();
  const draft = useWorkDraft<ScanLocationResult | null>(
    `count-location:${sessionId}`,
    null
  );
  const place = draft.value;
  // Accepted scans keep their original meaning even before the location response arrives.
  const routing = useRef<CountLocationIntent | null | undefined>(undefined);
  const changingLocation = useRef(false);
  const [switchingLocation, setSwitchingLocation] = useState(false);
  useEffect(() => {
    if (draft.ready && routing.current === undefined)
      routing.current = place
        ? { locationCode: place.locationCode, locationId: place.locationId }
        : null;
  }, [draft.ready, place]);
  const [manualCode, setManualCode] = useState('');
  const locationSearch = useLocationSearch(
    detail.data?.warehouseId ?? null,
    place ? '' : manualCode
  );
  const [editing, setEditing] = useState<EditingLine | null>(null);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [resetting, setResetting] = useState<ScanLocationItem | null>(null);
  const applyCount = (result: ScanProductResult) =>
    draft.update((prev) =>
      prev
        ? {
            ...prev,
            expectedItems: prev.expectedItems.map((item) =>
              item.lineId === result.lineId &&
              (item.lineRevision ?? 0) <= (result.lineRevision ?? 0)
                ? {
                    ...item,
                    countedQuantity: result.countedQuantity,
                    lineRevision: result.lineRevision,
                    countBaselineVersion: result.countBaselineVersion,
                    status: 'counted',
                  }
                : item
            ),
          }
        : prev
    );
  useEffect(() => {
    if (!detail.data || !draft.ready) return;
    void draft
      .update((prev) =>
        prev
          ? {
              ...prev,
              expectedItems: [
                ...prev.expectedItems.map((item) => {
                  const line = detail.data!.lines.find(
                    (line) => line.lineId === item.lineId
                  );
                  return line &&
                    (line.lineRevision ?? 0) > (item.lineRevision ?? 0)
                    ? { ...item, ...line }
                    : item;
                }),
                ...detail
                  .data!.lines.filter(
                    (line) =>
                      line.locationId === prev.locationId &&
                      !prev.expectedItems.some(
                        (item) => item.lineId === line.lineId
                      )
                  )
                  .map((line) => ({ ...line, barcode: line.scannedBarcode })),
              ],
            }
          : prev
      )
      .catch(() => {});
  }, [detail.data, draft.ready]);
  async function enterLocation(code: string, key?: string) {
    const result = await scanLocation.mutateAsync({
      sessionId,
      locationBarcode: code,
      idempotencyKey: key,
    });
    await draft.update(() => result);
    if (!routing.current || routing.current.locationCode === code)
      routing.current = {
        locationCode: result.locationCode,
        locationId: result.locationId,
      };
    setManualCode('');
    return result;
  }
  const scanQueue = useWorkScanQueue<CountScan>(async (input, id) => {
    setNotice(null);
    try {
      if (input.kind === 'location') {
        routing.current = { locationCode: input.code };
        await enterLocation(input.code, id);
        return;
      }
      const current = await draft.read();
      if (
        input.kind !== 'product' ||
        !current ||
        current.locationCode !== input.location.locationCode ||
        (input.location.locationId &&
          current.locationId !== input.location.locationId)
      ) {
        // Only an event with no durable mutation can be explicitly excluded.
        const existing = runtime ? await runtime.store.get(id) : null;
        if (!existing)
          throw new UnsentCountScanError(
            '이 스캔은 반영되지 않았어요. 위치를 확인한 뒤 다시 찍어 주세요.'
          );
        throw new Error('스캔한 위치의 처리 내역을 먼저 확인해 주세요.');
      }
      const result = await scanProduct.mutateAsync({
        sessionId,
        locationId: current.locationId,
        productBarcode: input.code,
        quantity: 1,
        idempotencyKey: id,
      });
      if (current.expectedItems.some((item) => item.lineId === result.lineId))
        await applyCount(result);
      else await enterLocation(current.locationCode, `${id}:location`);
    } catch (error) {
      setNotice(errorMessage(error, 'stocktaking'));
      if (!(error instanceof ApiError && error.outcome === 'rejected'))
        throw error;
      if (input.kind === 'location') routing.current = null;
    }
  }, `count:${sessionId}`);
  function acceptScan(code: string, location = false) {
    const target = routing.current;
    if (target === undefined || changingLocation.current) {
      setNotice('위치를 확인하고 있어요. 잠시 후 다시 찍어 주세요.');
      return;
    }
    if (location || target === null) {
      routing.current = { locationCode: code };
      scanQueue.enqueue({ kind: 'location', code });
    } else {
      scanQueue.enqueue({ kind: 'product', code, location: { ...target } });
    }
  }
  async function changeLocation() {
    if (
      scanQueue.blocked() ||
      updateCount.isPending ||
      resetCount.isPending ||
      changingLocation.current
    ) {
      setNotice('앞선 스캔의 처리 내역을 확인한 뒤 위치를 바꿔 주세요.');
      return;
    }
    changingLocation.current = true;
    setSwitchingLocation(true);
    try {
      await draft.update(() => null);
      routing.current = null;
    } catch (error) {
      setNotice(errorMessage(error, 'stocktaking'));
    } finally {
      changingLocation.current = false;
      setSwitchingLocation(false);
    }
  }
  useScanner((event) => {
    if (
      editing ||
      adding ||
      resetting ||
      updateCount.isPending ||
      resetCount.isPending ||
      !draft.ready
    ) {
      setNotice('현재 수량 입력을 마친 뒤 다시 찍어 주세요.');
      return;
    }
    acceptScan(event.code);
  });
  const busy =
    scanQueue.blocked() ||
    updateCount.isPending ||
    resetCount.isPending ||
    switchingLocation ||
    adding ||
    !!editing;
  const progress = detail.data?.progress;
  return (
    <div className="space-y-4">
      <ScreenHeader
        title={detail.data?.sessionName ?? '실사'}
        backTo="/stocktaking"
        right={
          progress ? (
            <span data-testid="progress">
              {progress.counted} / {progress.total}
            </span>
          ) : null
        }
      />
      {detail.isError && (
        <p role="alert">{errorMessage(detail.error, 'stocktaking')}</p>
      )}
      {notice && (
        <p role="status" className="text-sm text-amber-700">
          {notice}
        </p>
      )}
      {!!(scanQueue.error() || draft.error) && (
        <p role="alert">
          {scanQueue.storageError()
            ? SCAN_STORAGE_MESSAGE
            : '작업을 확인하지 못했어요.'}{' '}
          <Button onClick={() => void scanQueue.retryHead().catch(() => {})}>
            처리 내역 확인
          </Button>
          {scanQueue.error() instanceof UnsentCountScanError && (
            <Button onClick={() => void scanQueue.rejectHead().catch(() => {})}>
              이 스캔 제외
            </Button>
          )}
        </p>
      )}
      {!place ? (
        <section className="space-y-3">
          <div className="rounded-xl border border-dashed border-blue-300 bg-blue-50 p-8 text-center">
            <p>로케이션 바코드를 스캔하세요</p>
            <p>스캔하면 그 위치의 상품이 나와요.</p>
          </div>
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (manualCode.trim() && !busy)
                acceptScan(manualCode.trim(), true);
            }}
          >
            <label htmlFor="loc-manual" className="sr-only">
              로케이션 코드 직접 입력
            </label>
            <input
              id="loc-manual"
              className="flex-1 rounded-md border px-3 py-2"
              placeholder="코드 직접 입력"
              value={manualCode}
              disabled={busy}
              onChange={(e) => setManualCode(e.target.value)}
            />
            <Button type="submit" disabled={busy || !draft.ready}>
              열기
            </Button>
          </form>
          {locationSearch.isError && (
            <p role="alert">로케이션을 찾지 못했어요.</p>
          )}
          <ul>
            {(locationSearch.data?.items ?? []).map((location) => (
              <li key={location.id}>
                <Button
                  disabled={busy || locationSearch.isFetching || !draft.ready}
                  onClick={() => acceptScan(location.code, true)}
                >
                  {location.code} 열기
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="flex-1 rounded-lg border border-blue-500 bg-blue-50 px-3 py-2">
              {place.locationCode}
            </span>
            <Button disabled={busy} onClick={() => void changeLocation()}>
              다른 로케이션
            </Button>
          </div>
          <p className="text-xs text-gray-500">
            상품 바코드를 스캔하면 1개씩 올라가요. 박스 단위는 수량 입력을
            쓰세요.
          </p>
          <BarcodeInput
            label="실사 상품 바코드"
            disabled={busy || !draft.ready}
            onSubmit={(code) => acceptScan(code)}
          />
          <Button
            disabled={busy || !draft.ready}
            onClick={() => setAdding(true)}
          >
            상품 추가
          </Button>
          <fieldset disabled={busy}>
            <ul className="space-y-2">
              {place.expectedItems.map((item) => (
                <li key={item.lineId}>
                  <LineRow
                    item={item}
                    onEdit={() => {
                      if (item.lineRevision === undefined) {
                        setNotice('최신 수량을 확인해 주세요.');
                        return;
                      }
                      setEditing({
                        lineId: item.lineId,
                        skuName: item.skuName,
                        value: String(item.countedQuantity ?? 0),
                        revision: item.lineRevision,
                      });
                    }}
                  />
                  <Button
                    className="mt-1 text-xs"
                    disabled={item.lineRevision === undefined}
                    onClick={() => setResetting(item)}
                  >
                    다시 세기
                  </Button>
                </li>
              ))}
            </ul>
          </fieldset>
        </section>
      )}
      <Link to="/stocktaking/$sessionId/variances" params={{ sessionId }}>
        <Button disabled={busy} className="w-full py-3">
          차이 확인 →
        </Button>
      </Link>
      {resetting && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="다시 세기"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.preventDefault();
          }}
        >
          <section className="rounded-xl bg-white p-5">
            <p>{resetting.skuName}의 카운트를 지우고 처음부터 다시 셉니다.</p>
            <Button
              disabled={resetCount.isPending}
              onClick={() => setResetting(null)}
            >
              취소
            </Button>
            <Button
              disabled={resetCount.isPending}
              onClick={async () => {
                try {
                  await resetCount.mutateAsync({
                    sessionId,
                    lineId: resetting.lineId,
                    expectedRevision: resetting.lineRevision!,
                  });
                  if (place) await enterLocation(place.locationCode);
                  setResetting(null);
                } catch (e) {
                  setNotice(errorMessage(e, 'stocktaking'));
                }
              }}
            >
              다시 세기 시작
            </Button>
          </section>
        </div>
      )}
      {adding && place && (
        <AddCountItemSheet
          sessionId={sessionId}
          place={place}
          onCancel={() => setAdding(false)}
          onConflict={async (skuId) => {
            const latest = await enterLocation(place.locationCode);
            return latest.expectedItems.find((item) => item.skuId === skuId);
          }}
          onExisting={(item) => {
            setAdding(false);
            if (item.lineRevision === undefined) {
              setNotice('최신 수량을 확인해 주세요.');
              return;
            }
            setEditing({
              lineId: item.lineId,
              skuName: item.skuName,
              value: String(item.countedQuantity ?? 0),
              revision: item.lineRevision,
            });
          }}
          onDone={async (key) => {
            await enterLocation(place.locationCode, `${key}:location`);
            setAdding(false);
          }}
        />
      )}
      <QuantityDialog
        editing={editing}
        pending={updateCount.isPending}
        onCancel={() => {
          if (!updateCount.isPending) setEditing(null);
        }}
        onChange={(value) =>
          setEditing((prev) => (prev ? { ...prev, value } : prev))
        }
        onSave={async () => {
          if (!editing || parseQuantity(editing.value, 0) === null) return;
          try {
            const result = await updateCount.mutateAsync({
              sessionId,
              lineId: editing.lineId,
              countedQuantity: parseQuantity(editing.value, 0)!,
              expectedRevision: editing.revision,
            });
            await applyCount(result);
            setEditing(null);
          } catch (e) {
            setEditing(null);
            setNotice(errorMessage(e, 'stocktaking'));
          }
        }}
      />
    </div>
  );
}

function LineRow({
  item,
  onEdit,
}: {
  item: ScanLocationItem;
  onEdit: () => void;
}) {
  const counted = item.countedQuantity;
  const diff = counted === null ? null : counted - item.expectedQuantity;
  return (
    <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-3">
      <span className="flex-1">
        <span className="block font-medium text-gray-800">{item.skuName}</span>
        <span className="block font-mono text-xs text-gray-500">
          {item.skuCode}
        </span>
      </span>
      <span className="text-center">
        <span className="block text-xs text-gray-500">예상</span>
        <span className="block text-sm text-gray-700">
          {item.expectedQuantity}
        </span>
      </span>
      <span className="text-center">
        <span className="block text-xs text-gray-500">카운트</span>
        <span
          data-testid={`count-${item.lineId}`}
          className={cn(
            'block text-lg font-semibold',
            counted === null && 'text-gray-400',
            diff !== null && diff === 0 && 'text-gray-900',
            diff !== null && diff !== 0 && 'text-red-600'
          )}
        >
          {counted === null ? '—' : counted}
        </span>
      </span>
      <Button
        type="button"
        aria-label={`${item.skuName} 수량 입력`}
        className="px-3 py-1.5 text-xs"
        onClick={onEdit}
      >
        수량
      </Button>
    </div>
  );
}

/**
 * 수량 직접 입력 다이얼로그. Task 6 의 ConfirmDialog 와 달리 자체 마크업이라
 * 포커스·Escape 처리를 여기서 직접 한다 — 같은 이유로 버튼은 절대 포커스하지
 * 않는다(패널만 포커스). HID 스캐너는 종단에 Enter 를 보내는데, 포커스가
 * 저장 버튼에 가 있으면 그 Enter 가 저장을 눌러버려 다이얼로그가 열린 채로
 * 스캔한 셈이 된다 — 다이얼로그가 죽어있어야 할 스캔 경로가 버튼 포커스로
 * 되살아나는 것과 같은 사고이므로 패널에 포커스하고 Enter 는 흡수한다.
 */
function QuantityDialog({
  editing,
  pending,
  onCancel,
  onChange,
  onSave,
}: {
  editing: EditingLine | null;
  pending: boolean;
  onCancel: () => void;
  onChange: (v: string) => void;
  onSave: () => void;
}) {
  useUnsavedWork(!!editing);
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (editing) {
      previouslyFocusedRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      panelRef.current?.focus();
    } else {
      previouslyFocusedRef.current?.focus();
      previouslyFocusedRef.current = null;
    }
  }, [editing?.lineId]);

  useEffect(() => {
    if (!editing) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [editing, onCancel]);

  if (!editing) return null;

  // 스캐너의 종단 Enter 는 포커스가 어디에 있든 여기서 흡수한다 — 실제 저장은
  // pointer/touch tap 으로만 가능해야 한다(ConfirmDialog 와 같은 방어).
  function handlePanelKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Enter' || e.code === 'NumpadEnter') {
      e.preventDefault();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${editing.skuName} 수량`}
        tabIndex={-1}
        onKeyDown={handlePanelKeyDown}
        className="w-full max-w-sm space-y-3 rounded-xl bg-white p-5 shadow-lg outline-none"
      >
        <h2 className="text-base font-semibold text-gray-900">
          {editing.skuName}
        </h2>
        <div className="rounded-lg border border-gray-200 p-3 text-center text-2xl font-semibold text-gray-900">
          {editing.value}
        </div>
        <fieldset disabled={pending}>
          <QuantityInput
            label="실물 총수량 직접 입력"
            value={editing.value}
            onChange={onChange}
            min={0}
          />
          <NumberPad
            value={parseQuantity(editing.value, 0) ?? 0}
            onChange={(v) => onChange(String(v))}
          />
        </fieldset>
        <div className="flex gap-2">
          <Button
            type="button"
            className="flex-1 border border-gray-300 bg-white text-gray-800 hover:bg-gray-50"
            onClick={onCancel}
          >
            취소
          </Button>
          <Button
            type="button"
            className="flex-1"
            disabled={pending || parseQuantity(editing.value, 0) === null}
            onClick={onSave}
          >
            저장
          </Button>
        </div>
      </div>
    </div>
  );
}

export function SessionCountScreen(
  props: Parameters<typeof SessionCountScreenContent>[0]
) {
  return (
    <WorkArea kind="stocktaking">
      <SessionCountScreenContent key={props.sessionId} {...props} />
    </WorkArea>
  );
}
