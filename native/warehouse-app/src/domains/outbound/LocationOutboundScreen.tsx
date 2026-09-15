import { useEffect, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useWarehouse } from '../../app/warehouse-context';
import {
  localStoragePrefs,
  type DevicePrefs,
} from '../../core/data/devicePrefs';
import { ApiError } from '../../core/data/httpClient';
import { errorMessage } from '../../core/data/errorMessage';
import { Button } from '../../core/design/Button';
import { ScreenHeader } from '../../core/design/ScreenHeader';
import { QuantityInput, parseQuantity } from '../../core/design/QuantityInput';
import { BarcodeInput } from '../../core/hardware/scan/BarcodeInput';
import { useScanner } from '../../core/hardware/scan/useScanner';
import {
  useWorkScanQueue,
  SCAN_STORAGE_MESSAGE,
} from '../../core/hardware/scan/useWorkScanQueue';
import { useWorkDraft } from '../../core/operations/useWorkDraft';
import { useWorkRuntime } from '../../core/operations/OperationContext';
import { useWorkCapabilities } from '../../core/operations/useWorkCapabilities';
import { useUnsavedWork } from '../../core/operations/useUnsavedWork';
import {
  WorkArea,
  useWorkAreaBlocked,
} from '../../core/operations/WorkBoundary';
import { clearLastBox } from './lastBox';
import {
  useLocationOutbound,
  outboundRemainingSignature,
} from './locationOutbound';
import { OutboundSourcePicker } from './OutboundSourcePicker';
import type { LocationOutboundState, ShipmentByWaybill } from './types';
type ScanInput = {
  warehouseId: string;
  sourceLocationId: string;
  barcode: string;
  quantity: number;
};
function LocationWork({
  shipment,
  warehouseId,
  prefs,
}: {
  shipment: ShipmentByWaybill;
  warehouseId: string;
  prefs: DevicePrefs;
}) {
  const shipmentId = shipment.shipmentId;
  const runtime = useWorkRuntime();
  const capabilities = useWorkCapabilities();
  const operations = useLocationOutbound();
  const initial = useRef({
    startKey: crypto.randomUUID(),
    started: false,
    sourceId: null as string | null,
  });
  const draft = useWorkDraft(
    `location-outbound:${shipmentId}`,
    initial.current
  );
  const [work, setWork] = useState<LocationOutboundState | null>(null);
  const workRef = useRef(work);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [mode, setMode] = useState<'location' | 'product'>('location');
  const [quantity, setQuantity] = useState('1');
  const quantityRef = useRef('1');
  const editQuantity = (value: string) => {
    quantityRef.current = value;
    setQuantity(value);
  };
  const [forceOpen, setForceOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [forceKey, setForceKey] = useState(() => crypto.randomUUID());
  const version = useRef(0);
  useUnsavedWork(forceOpen || busy);
  function apply(state: LocationOutboundState) {
    if (state.warehouseId !== warehouseId || state.shipmentId !== shipmentId)
      throw new Error('출고 작업 범위를 확인해 주세요.');
    version.current++;
    workRef.current = state;
    setWork(state);
    if (state.status === 'shipped') clearLastBox(prefs);
  }
  async function refresh() {
    const before = version.current;
    const current = await operations.read(shipmentId, warehouseId);
    if (before === version.current) apply(current);
    return current;
  }
  const recoverRef = useRef(refresh);
  recoverRef.current = refresh;
  useEffect(() => {
    if (!draft.ready) return;
    let live = true;
    let requested = false;
    let running = false;
    let initialRecovery = true;
    async function recover() {
      requested = true;
      if (running || busyRef.current) return;
      running = true;
      const locksIntake = initialRecovery;
      if (locksIntake) {
        busyRef.current = true;
        setBusy(true);
      }
      try {
        // A restored operation can finish while the first read is in flight.
        // Keep its notification so we read the committed state afterward.
        while (live && requested) {
          requested = false;
          const saved = await draft.read();
          const op = runtime ? await runtime.store.get(saved.startKey) : null;
          if (!live || (!saved.started && op?.status !== 'confirmed')) continue;
          await recoverRef.current();
          if (!saved.started)
            await draft.update((prev) => ({ ...prev, started: true }));
        }
      } catch (e) {
        if (live) setNotice(errorMessage(e, 'outbound'));
      } finally {
        running = false;
        initialRecovery = false;
        if (locksIntake) {
          busyRef.current = false;
          if (live) setBusy(false);
        }
      }
    }
    void recover().catch((e) => {
      if (live) setNotice(errorMessage(e, 'outbound'));
    });
    const off = runtime?.runner.subscribe(() => {
      void recover().catch(() => {});
    });
    return () => {
      live = false;
      off?.();
    };
  }, [draft.ready, runtime]);
  const queue = useWorkScanQueue<ScanInput>(async (input, id) => {
    if (workRef.current?.status === 'shipped') {
      setNotice(
        '출고가 이미 완료되어 남은 스캔은 반영되지 않았어요. 포장 수량을 다시 확인해 주세요.'
      );
      return;
    }
    try {
      const result = await operations.scan.mutateAsync({
        shipmentId,
        ...input,
        idempotencyKey: id,
      });
      apply(result);
      // A confirmed queue replay returns its original response snapshot.
      // Keep the queue blocked until current source progress is reconciled.
      await refresh();
      setNotice(null);
    } catch (e) {
      setNotice(errorMessage(e, 'outbound'));
      if (!(e instanceof ApiError && e.outcome === 'rejected')) throw e;
      await refresh();
    }
  }, `location-outbound-scans:${shipmentId}`);
  const source = work?.sources.find(
    (item) => item.sourceLocationId === draft.value.sourceId
  );
  const scanAllowance = source
    ? {
        path: `/shipments/${shipmentId}/location-outbound-scans`,
        operationId: queue.head()?.id,
        warehouseId,
        sourceLocationId: source.sourceLocationId,
      }
    : undefined;
  const areaBlocked = useWorkAreaBlocked('outbound');
  const scanAreaBlocked = useWorkAreaBlocked('outbound', scanAllowance);
  const intakeBlocked =
    busy ||
    !queue.ready ||
    !!queue.error() ||
    forceOpen ||
    !draft.ready ||
    !!draft.error ||
    scanAreaBlocked;
  const blocked =
    areaBlocked ||
    busy ||
    queue.blocked() ||
    operations.force.isPending ||
    !draft.ready ||
    !!draft.error;
  async function chooseSource(id: string) {
    if (
      blocked ||
      queue.blocked() ||
      forceOpen ||
      busyRef.current ||
      !work?.sources.some(
        (item) => item.sourceLocationId === id && item.remainingQty > 0
      )
    )
      return;
    busyRef.current = true;
    setBusy(true);
    try {
      await draft.update((prev) => ({ ...prev, sourceId: id }));
      setMode('product');
      setNotice(null);
    } catch {
      setNotice('출발 위치를 저장하지 못했어요. 다시 선택해 주세요.');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  function chooseCode(code: string) {
    const found = work?.sources.find(
      (item) => item.sourceLocationCode === code && item.remainingQty > 0
    );
    if (found) void chooseSource(found.sourceLocationId);
    else
      setNotice(
        '이 위치에는 남은 출고 할당이 없어요. 표시된 위치를 확인해 주세요.'
      );
  }
  function acceptProduct(barcode: string) {
    const count = parseQuantity(quantityRef.current, 1);
    if (
      !work ||
      work.status === 'shipped' ||
      busyRef.current ||
      intakeBlocked ||
      mode !== 'product' ||
      !source ||
      count === null ||
      !draft.ready ||
      draft.error
    ) {
      setNotice('출발 위치와 수량을 확인한 뒤 상품을 입력해 주세요.');
      return;
    }
    queue.enqueue({
      warehouseId,
      sourceLocationId: source.sourceLocationId,
      barcode,
      quantity: count,
    });
    editQuantity('1');
  }
  useScanner((event) => {
    if (intakeBlocked || busyRef.current) return;
    if (mode === 'location') chooseCode(event.code);
    else acceptProduct(event.code);
  });
  const skuName = (skuId: string) =>
    shipment.lines.find((line) => line.skuId === skuId)?.skuName ??
    '상품 확인 필요';
  const remaining = work?.sources.filter((item) => item.remainingQty > 0) ?? [];
  const supported = capabilities.data?.locationOutbound === true;
  const canConfirm =
    remaining.length > 0 ||
    (!!work?.lines.length &&
      work.lines.every((line) => line.pickedQty >= line.qty));
  const forceValid =
    reason.trim().length > 0 &&
    canConfirm &&
    remaining.every(
      (item) =>
        parseQuantity(
          counts[`${item.shipmentLineId}:${item.sourceLocationId}`] ?? '',
          1
        ) === item.remainingQty
    );
  return (
    <div className="space-y-4">
      <WorkArea kind="outbound">
        <ScreenHeader title="출고작업" backTo="/outbound" />
      </WorkArea>
      <p>
        {shipment.carrier} {shipment.trackingNo} · {shipment.recipientMasked}
      </p>
      {notice && <p role="alert">{notice}</p>}
      {(busy || !draft.ready || !queue.ready) && !queue.error() && (
        <p role="status">작업을 확인하고 있어요. 잠시만 기다려 주세요.</p>
      )}
      {!supported && !capabilities.isPending && (
        <p role="alert">
          위치를 확인하는 출고를 사용하려면 서버 연결과 업데이트를 확인해
          주세요.
          <Button onClick={() => void capabilities.refetch()}>다시 확인</Button>
        </p>
      )}
      {!!draft.error && (
        <p role="alert">작업을 저장하지 못했어요. 저장 공간을 확인해 주세요.</p>
      )}
      {!!queue.error() && (
        <p role="alert">
          {queue.storageError()
            ? SCAN_STORAGE_MESSAGE
            : '출고 처리 내역을 먼저 확인해 주세요.'}
          <Button onClick={() => void queue.retryHead().catch(() => {})}>
            처리 내역 확인
          </Button>
        </p>
      )}
      {!work ? (
        <Button
          disabled={!supported || blocked}
          onClick={async () => {
            if (busyRef.current) return;
            busyRef.current = true;
            setBusy(true);
            setNotice(null);
            try {
              const current = await draft.read();
              await draft.update((prev) => ({
                ...prev,
                startKey: current.startKey,
              }));
              await operations.start.mutateAsync({
                shipmentId,
                warehouseId,
                idempotencyKey: current.startKey,
              });
              await refresh();
              await draft.update((prev) => ({ ...prev, started: true }));
            } catch (e) {
              setNotice(errorMessage(e, 'outbound'));
              if (e instanceof ApiError && e.outcome === 'rejected')
                await draft
                  .update((prev) => ({
                    ...prev,
                    startKey: crypto.randomUUID(),
                  }))
                  .catch(() => {});
            } finally {
              busyRef.current = false;
              setBusy(false);
            }
          }}
        >
          출고 준비
        </Button>
      ) : work.status === 'shipped' ? (
        <section>
          <p className="text-xl font-semibold">출고완료</p>
          <WorkArea kind="outbound">
            <Link to="/outbound" disabled={blocked}>
              <Button disabled={blocked}>다음 송장 스캔</Button>
            </Link>
          </WorkArea>
        </section>
      ) : (
        <>
          <ul className="space-y-2">
            {work.sources.map((item) => (
              <li
                key={`${item.shipmentLineId}:${item.sourceLocationId}`}
                className="rounded border p-3"
              >
                {skuName(item.skuId)} · {item.sourceLocationCode} · 할당{' '}
                {item.allocatedQty} / 피킹 {item.pickedQty} / 남은{' '}
                {item.remainingQty}개
              </li>
            ))}
          </ul>
          <WorkArea kind="outbound">
            {mode === 'location' ? (
              <OutboundSourcePicker
                sources={work.sources}
                disabled={blocked || forceOpen}
                onSelect={(id) => void chooseSource(id)}
                onCode={chooseCode}
              />
            ) : (
              <div className="flex gap-3">
                <p>
                  출발 위치:{' '}
                  {source?.sourceLocationCode ?? '다시 선택해 주세요'}
                </p>
                <Button
                  disabled={blocked || forceOpen}
                  onClick={() => {
                    if (!queue.blocked() && !busyRef.current)
                      setMode('location');
                  }}
                >
                  위치 변경
                </Button>
              </div>
            )}
          </WorkArea>
          <WorkArea kind="outbound" scanAllowance={scanAllowance}>
            <QuantityInput
              label="다음 스캔 수량"
              value={quantity}
              onChange={editQuantity}
              min={1}
              disabled={intakeBlocked}
            />
            <BarcodeInput
              label="출고 상품 바코드"
              disabled={!source || mode !== 'product' || intakeBlocked}
              onSubmit={acceptProduct}
            />
          </WorkArea>
          <WorkArea kind="outbound">
            <Button
              disabled={blocked || !canConfirm}
              onClick={() => {
                if (queue.blocked() || busyRef.current) return;
                setForceOpen(true);
                setReason('');
                setCounts({});
                setForceKey(crypto.randomUUID());
              }}
            >
              스캔 생략 확인
            </Button>
            <Button
              disabled={blocked || forceOpen}
              onClick={() => {
                busyRef.current = true;
                setBusy(true);
                void refresh()
                  .catch((e) => setNotice(errorMessage(e, 'outbound')))
                  .finally(() => {
                    busyRef.current = false;
                    setBusy(false);
                  });
              }}
            >
              작업 새로고침
            </Button>
          </WorkArea>
        </>
      )}
      {forceOpen && work && (
        <WorkArea kind="outbound">
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <section
              role="dialog"
              aria-modal="true"
              aria-label="위치별 실물 확인"
              className="max-h-[90vh] w-full max-w-lg space-y-3 overflow-y-auto rounded-xl bg-white p-5"
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.preventDefault();
              }}
            >
              <h2 className="font-semibold">위치별 실물 확인</h2>
              {remaining.length === 0 && (
                <p>
                  모든 수량이 피킹되어 있어요. 포장 실물을 확인한 뒤 출고를
                  완료해 주세요.
                </p>
              )}
              <p>각 위치에서 확인한 남은 낱개 수량을 입력해 주세요.</p>
              {remaining.map((item) => (
                <QuantityInput
                  key={`${item.shipmentLineId}:${item.sourceLocationId}`}
                  label={`${skuName(item.skuId)} · ${item.sourceLocationCode} 실물 수량 (${item.remainingQty}개 남음)`}
                  value={
                    counts[`${item.shipmentLineId}:${item.sourceLocationId}`] ??
                    ''
                  }
                  min={1}
                  max={item.remainingQty}
                  disabled={busy}
                  onChange={(value) => {
                    setCounts((prev) => ({
                      ...prev,
                      [`${item.shipmentLineId}:${item.sourceLocationId}`]:
                        value,
                    }));
                    setForceKey(crypto.randomUUID());
                  }}
                />
              ))}
              <label className="block">
                스캔 생략 사유
                <input
                  aria-label="스캔 생략 사유"
                  className="w-full rounded border p-2"
                  value={reason}
                  disabled={busy}
                  onChange={(e) => {
                    setReason(e.target.value);
                    setForceKey(crypto.randomUUID());
                  }}
                />
              </label>
              <Button disabled={busy} onClick={() => setForceOpen(false)}>
                취소
              </Button>
              <Button
                disabled={busy || !forceValid}
                onClick={async () => {
                  if (busyRef.current) return;
                  busyRef.current = true;
                  setBusy(true);
                  try {
                    const latest = await operations.read(
                      shipmentId,
                      warehouseId
                    );
                    if (
                      outboundRemainingSignature(latest) !==
                      outboundRemainingSignature(work)
                    ) {
                      apply(latest);
                      setForceOpen(false);
                      setNotice(
                        '남은 수량이 바뀌었어요. 최신 위치별 수량을 다시 확인해 주세요.'
                      );
                      return;
                    }
                    const state = await operations.force.mutateAsync({
                      shipmentId,
                      warehouseId,
                      reason: reason.trim(),
                      items: remaining.map((item) => ({
                        shipmentLineId: item.shipmentLineId,
                        sourceLocationId: item.sourceLocationId,
                        quantity: parseQuantity(
                          counts[
                            `${item.shipmentLineId}:${item.sourceLocationId}`
                          ],
                          1
                        )!,
                      })),
                      idempotencyKey: forceKey,
                    });
                    apply(state);
                    setForceOpen(false);
                  } catch (e) {
                    setNotice(errorMessage(e, 'outbound'));
                    setForceOpen(false);
                    await refresh().catch(() => {});
                  } finally {
                    busyRef.current = false;
                    setBusy(false);
                  }
                }}
              >
                확인한 수량 출고
              </Button>
            </section>
          </div>
        </WorkArea>
      )}
    </div>
  );
}
export function LocationOutboundScreen({
  shipmentId,
  shipment,
  prefs = localStoragePrefs,
}: {
  shipmentId: string;
  shipment: ShipmentByWaybill | null;
  prefs?: DevicePrefs;
}) {
  const { warehouseId } = useWarehouse();
  return (
    <>
      {!shipment ||
      shipment.shipmentId !== shipmentId ||
      !warehouseId ||
      shipment.warehouseId !== warehouseId ? (
        <>
          <ScreenHeader title="출고작업" backTo="/outbound" />
          <p role="alert">
            송장과 선택 창고를 확인해 주세요. 같은 창고에서 송장을 다시 조회해
            주세요.
          </p>
        </>
      ) : shipment.shipmentStatus === 'shipped' ? (
        <p>출고완료</p>
      ) : (
        <LocationWork
          key={`${warehouseId}:${shipmentId}`}
          shipment={shipment}
          warehouseId={warehouseId}
          prefs={prefs}
        />
      )}
    </>
  );
}
