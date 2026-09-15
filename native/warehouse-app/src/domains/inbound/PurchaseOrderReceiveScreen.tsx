import {
  confirmedPutawayQuantity,
  withConfirmedPutaway,
} from './confirmedPutaway';
import { useWorkDraft } from '../../core/operations/useWorkDraft';
import { useWorkRuntime } from '../../core/operations/OperationContext';
import type { ReceivePurchaseOrderResult } from './types';
import { WorkArea } from '../../core/operations/WorkBoundary';
import { useEffect, useRef, useState } from 'react';
import { useWarehouse } from '../../app/warehouse-context';
import { errorMessage } from '../../core/data/errorMessage';
import { Button } from '../../core/design/Button';
import { ConfirmDialog } from '../../core/design/ConfirmDialog';
import { ScreenHeader } from '../../core/design/ScreenHeader';
import {
  SCAN_STORAGE_MESSAGE,
  useWorkScanQueue,
} from '../../core/hardware/scan/useWorkScanQueue';
import { useScanner } from '../../core/hardware/scan/useScanner';
import { useSkuByBarcode } from '../inventory/useSkuByBarcode';
import { scanIncrement } from './packingUnit';
import { useExpectedArrivals } from './queries';
import {
  useCancelPurchaseOrderReceipt,
  useReceivePurchaseOrder,
} from './mutations';
import { PutawaySheet, type LocationRef } from './PutawaySheet';
import { ReceiveSheet } from './ReceiveSheet';
import { PoReceiveScanNotAppliedError } from './poReceiveScanError';
import type { ExpectedArrivalLine, FreshLine } from './types';

function createReadinessGate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release, open: false };
}

function PurchaseOrderReceiveScreenContent({ poId }: { poId: string }) {
  const { warehouseId, isSet } = useWarehouse();
  const arrivals = useExpectedArrivals(warehouseId);
  const lookup = useSkuByBarcode();
  const receive = useReceivePurchaseOrder();
  const cancel = useCancelPurchaseOrderReceipt();

  const initial = useRef({
    active: null as ExpectedArrivalLine | null,
    scanBump: 0,
    seen: [] as string[],
    fresh: null as FreshLine | null,
    submitted: null as {
      target: ExpectedArrivalLine;
      quantity: number;
      key: string;
    } | null,
  });
  const draft = useWorkDraft(
    `po-inbound:${warehouseId}:${poId}`,
    initial.current
  );
  const { active, scanBump, fresh } = draft.value;
  const setActive = (active: ExpectedArrivalLine | null) =>
    draft.update((prev) => ({ ...prev, active }));
  const setScanBump = (value: number) =>
    draft.update((prev) => ({ ...prev, scanBump: value }));
  const setFresh = (
    value: FreshLine | null | ((p: FreshLine | null) => FreshLine | null)
  ) =>
    draft.update((prev) => ({
      ...prev,
      fresh: typeof value === 'function' ? value(prev.fresh) : value,
    }));
  const runtime = useWorkRuntime();
  const [reconciled, setReconciled] = useState(!runtime);
  useEffect(() => {
    if (!runtime || !draft.ready) return;
    let live = true;
    const reconcile = async () => {
      const current = await draft.read();
      if (current.submitted) {
        const op = await runtime.store.get(current.submitted.key);
        if (op?.status === 'confirmed') {
          const result = op.result as ReceivePurchaseOrderResult;
          const { target, quantity } = current.submitted;
          await draft.update((prev) =>
            prev.submitted?.key !== current.submitted?.key
              ? prev
              : {
                  ...prev,
                  active: null,
                  scanBump: 0,
                  submitted: null,
                  fresh: {
                    lineId: result.lines[0].receiptLineId,
                    skuId: target.skuId,
                    skuName: target.skuName,
                    skuCode: target.skuCode,
                    quantity,
                    putawayDoneQty: 0,
                  },
                }
          );
        }
      }
      const latest = await draft.read();
      if (latest.fresh) {
        const lineId = latest.fresh.lineId;
        const quantity = await confirmedPutawayQuantity(runtime, lineId);
        await draft.update((prev) => ({
          ...prev,
          fresh:
            prev.fresh?.lineId === lineId
              ? withConfirmedPutaway(prev.fresh, quantity)
              : prev.fresh,
        }));
      }
      if (live) setReconciled(true);
    };
    void reconcile().catch(() => {
      if (live) setReconciled(false);
    });
    const off = runtime.runner.subscribe(
      () => void reconcile().catch(() => {})
    );
    return () => {
      live = false;
      off();
    };
  }, [runtime, draft.ready, draft.value.submitted?.key]);
  const [notice, setNotice] = useState<string | null>(null);

  const [putawayOpen, setPutawayOpen] = useState(false);
  const [lastDest, setLastDest] = useState<LocationRef | null>(null);
  const [cancelConfirm, setCancelConfirm] = useState(false);

  const purchaseOrder = (arrivals.data?.arrivals ?? []).find(
    (arrival) => arrival.documentId === poId
  );
  const lines = purchaseOrder?.lines ?? [];

  // 시트는 열릴 때 스냅샷(active)을 잡지만, 표시는 매 렌더 lines 에서 같은
  // skuId 를 다시 찾아 쓴다 — onSettled 무효화로 잔여/입고 수량이 바뀌어도
  // 시트가 옛 숫자를 계속 보여주면 현재 발주 상태를 오해하게 된다. 다만 품목
  // 소실이나 잔량 감소만으로 제출 성공을 추정하지 않고, 저장된 스냅샷과 수량은
  // 명시적인 확인 또는 취소 때까지 보존한다.
  const currentActiveItem = active
    ? lines.find((line) => line.skuId === active.skuId)
    : undefined;
  const activeItem = active ? (currentActiveItem ?? active) : null;
  const activeStateChanged =
    !!active &&
    (!currentActiveItem ||
      currentActiveItem.outstandingQty < active.outstandingQty);
  const arrivalsReady = arrivals.isSuccess && !arrivals.isFetching;
  const scansCanRun = draft.ready && reconciled && arrivalsReady;
  const scansCanRunRef = useRef(scansCanRun);
  scansCanRunRef.current = scansCanRun;
  const scanGateRef = useRef(createReadinessGate());
  if (!scansCanRun && scanGateRef.current.open) {
    scanGateRef.current = createReadinessGate();
  }
  useEffect(() => {
    if (!scansCanRun) return;
    scanGateRef.current.open = true;
    scanGateRef.current.release();
  }, [scansCanRun]);
  const linesRef = useRef(lines);
  linesRef.current = lines;
  const purchaseOrderRef = useRef(purchaseOrder);
  purchaseOrderRef.current = purchaseOrder;
  async function waitForScanReadiness() {
    while (!scansCanRunRef.current) await scanGateRef.current.promise;
  }

  function assertScanCanApply(current: typeof initial.current) {
    const currentOrder = purchaseOrderRef.current;
    const currentLine = current.active
      ? linesRef.current.find((line) => line.skuId === current.active?.skuId)
      : undefined;
    if (
      !currentOrder ||
      currentOrder.lines.length === 0 ||
      (current.active &&
        (!currentLine ||
          currentLine.outstandingQty < current.active.outstandingQty))
    ) {
      throw new PoReceiveScanNotAppliedError();
    }
  }

  // 취소도 같은 회전 규칙을 따라야 한다. receiptLineId 가 있는 한 payload 는
  // 배너가 떠 있는 동안 고정이므로, 재시도는 새 키가 아니라 같은
  // 키로 replay 해야 한다 — 안 그러면 "응답만 유실, 취소는 이미 성공" 뒤 다시
  // 누른 두 번째 시도가 새 키로 서버에 다시 들어가 "이미 취소됨" 400 을 받고,
  // 성공한 취소를 실패로 오인해 배너가 안 내려간다.
  const cancelKeyRef = useRef<{ receiptLineId: string; key: string } | null>(
    null
  );
  function cancelKeyFor(receiptLineId: string): string {
    if (cancelKeyRef.current?.receiptLineId === receiptLineId)
      return cancelKeyRef.current.key;
    const key = crypto.randomUUID();
    cancelKeyRef.current = { receiptLineId, key };
    return key;
  }

  async function submitReceive(target: ExpectedArrivalLine, quantity: number) {
    if (!warehouseId || !draft.ready || !reconciled) return;
    const current = await draft.read();
    const previous = current.submitted;
    if (
      previous &&
      (previous.target.skuId !== target.skuId || previous.quantity !== quantity)
    )
      return;
    const submission = previous ?? {
      target,
      quantity,
      key: crypto.randomUUID(),
    };
    await draft.update((prev) => ({
      ...prev,
      submitted: submission,
    }));
    receive.mutate(
      {
        poId,
        warehouseId,
        lines: [
          {
            skuId: submission.target.skuId,
            quantity: submission.quantity,
          },
        ],
        idempotencyKey: submission.key,
      },
      {
        onSuccess: (result) => {
          setFresh({
            lineId: result.lines[0].receiptLineId,
            skuId: submission.target.skuId,
            skuName: submission.target.skuName,
            skuCode: submission.target.skuCode,
            quantity: submission.quantity,
            putawayDoneQty: 0,
          });
          void draft.update((prev) => ({ ...prev, submitted: null }));
          closeSheet();
        },
      }
    );
  }

  const activeRef = useRef(active);
  activeRef.current = active;
  const scanQueue = useWorkScanQueue<string>(async (code, eventId) => {
    await waitForScanReadiness();
    const beforeLookup = await draft.read();
    if (beforeLookup.seen.includes(eventId)) return;
    assertScanCanApply(beforeLookup);
    const skus = await lookup.mutateAsync(code);
    const sku = skus[0];
    await waitForScanReadiness();
    const current = await draft.read();
    if (current.seen.includes(eventId)) return;
    assertScanCanApply(current);
    const matched = sku
      ? linesRef.current.find((line) => line.skuId === sku.id)
      : undefined;
    if (!sku || !matched) {
      setNotice('이 발주에 없는 품목이에요.');
      return;
    }
    const step = scanIncrement(sku, code);
    if (current.active && current.active.skuId !== sku.id) {
      throw new Error('다른 품목이에요. 지금 수량을 먼저 확인해 주세요.');
    }
    setNotice(null);
    await draft.update((prev) => ({
      ...prev,
      active: prev.active ?? matched,
      scanBump: prev.active ? prev.scanBump + step : step,
      seen: [...prev.seen, eventId],
    }));
  }, `po-inbound:${warehouseId}:${poId}`);
  useScanner((e) => {
    if (putawayOpen) return;
    if (cancelConfirm || receive.isPending || !draft.ready) {
      setNotice('현재 작업을 마친 뒤 다시 찍어 주세요.');
      return;
    }
    scanQueue.enqueue(e.code);
  });

  function closeSheet() {
    activeRef.current = null;
    setActive(null);
    setScanBump(0);
  }

  const canDiscardInput =
    !draft.value.submitted &&
    scanQueue.ready &&
    scanQueue.size() === 0 &&
    !scanQueue.error() &&
    !draft.error;
  async function discardDraftInput() {
    const current = await draft.read();
    if (
      current.submitted ||
      !scanQueue.ready ||
      scanQueue.size() > 0 ||
      scanQueue.error() ||
      draft.error
    )
      return;
    closeSheet();
  }
  const discardInput = canDiscardInput ? (
    <Button
      type="button"
      className="border border-gray-300 bg-white text-gray-800 hover:bg-gray-50"
      onClick={() => void discardDraftInput()}
    >
      입력 취소
    </Button>
  ) : null;
  const sheetStatus = !arrivalsReady ? (
    arrivals.isError ? (
      <div className="space-y-2 rounded-md bg-red-50 p-3 text-sm text-red-700">
        <p role="alert">발주 정보를 확인하지 못했어요.</p>
        <div className="flex gap-2">
          <Button type="button" onClick={() => void arrivals.refetch()}>
            다시 확인
          </Button>
          {discardInput}
        </div>
      </div>
    ) : (
      <div className="space-y-2 rounded-md bg-gray-50 p-3 text-sm text-gray-700">
        <p role="status">발주 정보를 확인하고 있어요.</p>
        {discardInput}
      </div>
    )
  ) : activeStateChanged ? (
    <div className="space-y-2 rounded-md bg-amber-50 p-3 text-sm text-amber-800">
      <p role="alert">발주 상태가 바뀌었어요. 입고내역을 확인해 주세요.</p>
      <div className="flex gap-2">
        <Button type="button" onClick={() => void arrivals.refetch()}>
          다시 확인
        </Button>
        {discardInput}
      </div>
    </div>
  ) : draft.value.submitted ? (
    <p
      role="status"
      className="rounded-md bg-gray-50 p-3 text-sm text-gray-700"
    >
      저장된 입고 요청을 같은 내용으로 다시 확인해 주세요.
    </p>
  ) : null;

  if (!isSet) {
    return (
      <div className="space-y-4">
        <ScreenHeader title="발주 입고" backTo="/inbound" />
        <p className="text-sm text-gray-600">창고를 먼저 선택해 주세요.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ScreenHeader
        title={purchaseOrder?.supplier?.name ?? '발주 입고'}
        backTo="/inbound"
      />

      {draft.error ? (
        <p role="alert">작업을 저장하지 못했어요. 저장 공간을 확인해 주세요.</p>
      ) : null}
      {scanQueue.error() ? (
        <p role="alert">
          {scanQueue.storageError()
            ? SCAN_STORAGE_MESSAGE
            : '상품을 확인하지 못했어요.'}{' '}
          <Button onClick={() => void scanQueue.retryHead().catch(() => {})}>
            다시 확인
          </Button>
          {!scanQueue.storageError() && (
            <Button onClick={() => void scanQueue.rejectHead()}>
              이 스캔 제외
            </Button>
          )}
        </p>
      ) : null}
      {notice ? (
        <p
          role="alert"
          className="rounded-md bg-amber-50 p-2 text-sm text-amber-800"
        >
          {notice}
        </p>
      ) : null}

      {fresh ? (
        <div className="space-y-2 rounded-lg border border-green-300 bg-green-50 p-3">
          <p className="text-sm text-green-900">
            {fresh.skuName} {fresh.quantity}개 입고됨
            {/* 간편입고 적치 대기 행과 같은 어휘("잔여 N개 · M개 적치됨")를 쓴다 —
                두 화면의 부분 적치 진행 표시를 맞추기로 한 결정. */}
            {fresh.putawayDoneQty >= fresh.quantity
              ? ' · 적치 완료'
              : fresh.putawayDoneQty > 0
                ? ` · 잔여 ${fresh.quantity - fresh.putawayDoneQty}개 · ${fresh.putawayDoneQty}개 적치됨`
                : ''}
          </p>
          <div className="flex gap-2">
            {fresh.putawayDoneQty < fresh.quantity ? (
              <Button
                type="button"
                className="flex-1 py-1.5 text-xs"
                disabled={!reconciled || !!draft.error}
                onClick={() => setPutawayOpen(true)}
              >
                적치하기
              </Button>
            ) : null}
            {/* 취소는 적치 전에만 가능하다 — 서버가 putawayFromOriginQty > 0 이면 거부한다.
                부분 적치도 그 조건에 걸리므로 누계가 0 일 때만 노출한다.
                확인 다이얼로그가 뜬 동안은 감춘다 — 다이얼로그도 [취소] 버튼을 쓰므로
                접근성 이름이 겹치고, 배너 쪽은 어차피 조작할 대상이 아니다. */}
            {fresh.putawayDoneQty === 0 && !cancelConfirm ? (
              <Button
                type="button"
                className="flex-1 border border-red-300 bg-white py-1.5 text-xs text-red-700 hover:bg-red-50"
                onClick={() => setCancelConfirm(true)}
              >
                취소
              </Button>
            ) : null}
            <Button
              type="button"
              className="flex-1 border border-gray-300 bg-white py-1.5 text-xs text-gray-700 hover:bg-gray-50"
              onClick={() => setFresh(null)}
            >
              닫기
            </Button>
          </div>
          {cancel.isError ? (
            <p role="alert" className="text-xs text-red-700">
              {errorMessage(cancel.error, 'inbound-cancel')}
            </p>
          ) : null}
        </div>
      ) : null}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-gray-700">발주 품목</h2>
        {arrivals.isError ? (
          <p role="alert" className="text-sm text-red-600">
            {errorMessage(arrivals.error, 'po-receive')}
          </p>
        ) : arrivals.isLoading ? (
          <p className="text-sm text-gray-500">불러오는 중…</p>
        ) : lines.length === 0 ? (
          <p className="text-sm text-gray-500">남은 발주 품목이 없어요.</p>
        ) : (
          <ul className="space-y-2">
            {lines.map((item) => (
              <li
                key={item.skuId}
                className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-3"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-gray-800">
                    {item.skuName}
                  </span>
                  <span className="block font-mono text-xs text-gray-500">
                    {item.skuCode}
                  </span>
                  <span className="block text-xs text-gray-500">
                    발주 {item.orderedQty} · 입고 {item.receivedQty} · 남은{' '}
                    {item.outstandingQty}
                  </span>
                </span>
                {/* 시트가 열려 있는 동안은 숨긴다 — 시트의 [입고] 버튼과 접근성 이름이
                    겹쳐서 role 쿼리가 모호해지고, 어차피 한 번에 한 항목만 다룬다. */}
                {!active ? (
                  <Button
                    className="shrink-0 px-3 py-1.5 text-xs"
                    onClick={() => {
                      setActive(item);
                      setScanBump(0);
                      setNotice(null);
                    }}
                  >
                    입고
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {activeItem ? (
        <ReceiveSheet
          item={activeItem}
          scanBump={draft.value.submitted?.quantity ?? scanBump}
          pending={
            receive.isPending ||
            scanQueue.blocked() ||
            !draft.ready ||
            !reconciled ||
            !arrivalsReady ||
            activeStateChanged
          }
          inputDisabled={!!draft.value.submitted}
          cancelDisabled={!canDiscardInput}
          error={
            receive.isError ? errorMessage(receive.error, 'po-receive') : null
          }
          statusContent={sheetStatus}
          onCancel={() => void discardDraftInput()}
          onSubmit={(quantity) =>
            submitReceive(
              draft.value.submitted?.target ?? activeItem,
              draft.value.submitted?.quantity ?? quantity
            )
          }
        />
      ) : null}

      <ConfirmDialog
        open={cancelConfirm}
        title="입고 취소"
        message={
          fresh
            ? `${fresh.skuName} ${fresh.quantity}개 입고를 전량 취소합니다.`
            : ''
        }
        confirmLabel="취소하기"
        danger
        onCancel={() => setCancelConfirm(false)}
        onConfirm={() => {
          setCancelConfirm(false);
          if (!fresh) return;
          cancel.mutate(
            {
              receiptLineId: fresh.lineId,
              idempotencyKey: cancelKeyFor(fresh.lineId),
            },
            {
              onSuccess: () => {
                cancelKeyRef.current = null;
                setFresh(null);
              },
            }
          );
        }}
      />

      {putawayOpen && fresh ? (
        <PutawaySheet
          target={{
            lineId: fresh.lineId,
            skuName: fresh.skuName,
            skuCode: fresh.skuCode,
            pendingQty: fresh.quantity - fresh.putawayDoneQty,
            originLocationCode: '입고기본존',
          }}
          warehouseId={warehouseId}
          lastDest={lastDest}
          onCancel={() => setPutawayOpen(false)}
          onDone={async (dest, quantity) => {
            setLastDest(dest);
            const confirmed = runtime
              ? await confirmedPutawayQuantity(runtime, fresh.lineId)
              : null;
            await setFresh((prev) =>
              prev?.lineId === fresh.lineId
                ? withConfirmedPutaway(
                    prev,
                    confirmed ?? prev.putawayDoneQty + quantity
                  )
                : prev
            );
            setPutawayOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

export function PurchaseOrderReceiveScreen(
  props: Parameters<typeof PurchaseOrderReceiveScreenContent>[0]
) {
  const { warehouseId } = useWarehouse();
  return (
    <WorkArea kind="inbound">
      <PurchaseOrderReceiveScreenContent
        key={`${warehouseId ?? 'no-warehouse'}:${props.poId}`}
        {...props}
      />
    </WorkArea>
  );
}
