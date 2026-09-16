import { useCallback, useEffect, useRef, useState } from 'react';
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
import {
  useWorkCapabilities,
  useWorkPermissions,
} from '../../core/operations/useWorkCapabilities';
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
  const permissions = useWorkPermissions();
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
  const [startRejection, setStartRejection] = useState<ApiError | null>(null);
  const [stateUnavailable, setStateUnavailable] = useState(false);
  const stateUnavailableRef = useRef(false);
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
    stateUnavailableRef.current = false;
    setStateUnavailable(false);
    if (state.status === 'shipped') clearLastBox(prefs);
  }
  async function refresh() {
    const before = version.current;
    try {
      const current = await operations.read(shipmentId, warehouseId);
      if (before === version.current) apply(current);
      return current;
    } catch (error) {
      if (before === version.current) {
        stateUnavailableRef.current = true;
        setStateUnavailable(true);
      }
      throw error;
    }
  }
  const readStartOperation = useCallback(
    async (key: string) => {
      if (!runtime) return null;
      const op = await runtime.store.get(key);
      if (
        op &&
        (op.scope !== (await runtime.getScope()) ||
          op.path !== `/shipments/${shipmentId}/location-outbound-starts` ||
          op.method !== 'POST' ||
          op.bodyJson !== JSON.stringify({ warehouseId }))
      )
        throw new Error('출고 작업 범위를 확인해 주세요.');
      return op;
    },
    [runtime, shipmentId, warehouseId]
  );
  function showStartRejection(op: {
    errorCode?: string;
    preparation?: ApiError['preparation'];
  }) {
    const error = new ApiError(
      '작업이 반영되지 않았어요.',
      400,
      op.errorCode,
      op.preparation
    );
    setStartRejection(error);
    setNotice(errorMessage(error, 'outbound'));
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
          const op = await readStartOperation(saved.startKey);
          if (live && op?.status === 'rejected') {
            showStartRejection(op);
            continue;
          }
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
  }, [draft.ready, runtime, readStartOperation]);
  const queue = useWorkScanQueue<ScanInput>(async (input, id) => {
    if (!stateUnavailableRef.current && workRef.current?.status === 'shipped') {
      setNotice(
        '출고가 이미 완료되어 남은 스캔은 반영되지 않았어요. 포장 수량을 다시 확인해 주세요.'
      );
      return;
    }
    try {
      await operations.scan.mutateAsync({
        shipmentId,
        ...input,
        idempotencyKey: id,
      });
      // A confirmed queue replay returns its original response snapshot.
      // Only the current GET may project completion or release this queue head.
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
    stateUnavailable ||
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
      stateUnavailableRef.current ||
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
      stateUnavailableRef.current ||
      work.status === 'shipped' ||
      busyRef.current ||
      intakeBlocked ||
      !!queue.error() ||
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
  const scanHandler = useRef<(code: string) => void>(() => {});
  scanHandler.current = (code) => {
    // The subscription may still be from a previous render. Always evaluate
    // the current source and lock policy, including synchronous queue failures.
    if (
      intakeBlocked ||
      stateUnavailableRef.current ||
      busyRef.current ||
      queue.error()
    )
      return;
    if (mode === 'location') chooseCode(code);
    else acceptProduct(code);
  };
  useScanner((event) => scanHandler.current(event.code));
  const skuName = (skuId: string) =>
    shipment.lines.find((line) => line.skuId === skuId)?.skuName ??
    '상품 확인 필요';
  const remaining = work?.sources.filter((item) => item.remainingQty > 0) ?? [];
  const supported = capabilities.data?.locationOutbound === true;
  const canForce =
    permissions.isSuccess &&
    !permissions.isFetching &&
    permissions.data.forceDispatch === true;
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
        startRejection?.preparation?.recovery === 'review_batch' ? (
          <WorkArea kind="outbound">
            <Link to="/outbound" disabled={blocked}>
              배치와 송장 확인
            </Link>
          </WorkArea>
        ) : (
          <Button
            disabled={!supported || blocked}
            onClick={async () => {
              if (busyRef.current) return;
              busyRef.current = true;
              setBusy(true);
              setNotice(null);
              try {
                const current = await draft.read();
                const previous = await readStartOperation(current.startKey);
                // Only a durable rejection and this explicit action create a new intent.
                // Uncertain work keeps its original key and body in the runner.
                if (
                  previous?.status === 'rejected' &&
                  previous.preparation?.recovery === 'review_batch'
                ) {
                  showStartRejection(previous);
                  return;
                }
                const startKey =
                  previous?.status === 'rejected'
                    ? crypto.randomUUID()
                    : current.startKey;
                await draft.update((prev) => ({
                  ...prev,
                  startKey,
                  started: false,
                  sourceId: null,
                }));
                setStartRejection(null);
                setForceOpen(false);
                setCounts({});
                setReason('');
                setMode('location');
                await operations.start.mutateAsync({
                  shipmentId,
                  warehouseId,
                  idempotencyKey: startKey,
                });
                await refresh();
                await draft.update((prev) => ({ ...prev, started: true }));
              } catch (e) {
                setNotice(errorMessage(e, 'outbound'));
                if (e instanceof ApiError && e.outcome === 'rejected') {
                  const current = await draft.read();
                  const saved = await readStartOperation(current.startKey);
                  if (saved?.status === 'rejected') showStartRejection(saved);
                }
              } finally {
                busyRef.current = false;
                setBusy(false);
              }
            }}
          >
            {startRejection ? '다시 준비' : '출고 준비'}
          </Button>
        )
      ) : work.status === 'shipped' && !stateUnavailable ? (
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
                disabled={blocked || stateUnavailable || forceOpen}
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
            {canForce ? (
              <Button
                disabled={blocked || stateUnavailable || !canConfirm}
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
            ) : (
              <p>
                스캔 생략 출고는 관리자 권한이 필요해요. 권한을 확인할 수 없으면
                연결과 로그인을 확인해 주세요.
              </p>
            )}
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
                    const latest = await refresh();
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
                    await operations.force.mutateAsync({
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
                    // A replay can return an old success snapshot. Display only the current GET.
                    await refresh();
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
