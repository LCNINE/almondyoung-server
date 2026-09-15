import { receiptFeedback } from './receiptFeedback';
import { useReceiptReconciliation } from './useReceiptReconciliation';
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
import { parseQuantity } from '../../core/design/QuantityInput';
import {
  normalizePoReceiveDraft,
  scanReceiptQuantity,
  PoReceiveQuantityError,
  type PoReceiveDraft,
} from './poReceiveDraft';
import { usePoReceiptQuantity } from './usePoReceiptQuantity';
import { ReceiveScanRecovery } from './ReceiveScanRecovery';
import {
  PoReceiveBarcodeNotFoundError,
  PoReceiveConfirmedUnappliedError,
  PoReceiveDifferentSkuError,
  PoReceiveScanNotAppliedError,
  PoReceiveSkuNotInOrderError,
} from './poReceiveScanError';
import type { FreshLine, PutawayTarget } from './types';

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

  const initial = useRef<PoReceiveDraft>({
    active: null,
    scanBump: 0,
    seen: [],
    fresh: null,
    submitted: null,
  });
  const draft = useWorkDraft(
    `po-inbound:${warehouseId}:${poId}`,
    initial.current
  );
  const quantity = usePoReceiptQuantity(draft);
  const { active, fresh } = draft.value;
  const receipt = useReceiptReconciliation({
    lineId: fresh?.lineId ?? null,
    warehouseId,
    expectedSource: 'purchase_order',
  });
  const [followupError, setFollowupError] = useState<string | null>(null);
  const followupLock = useRef(false);
  const submitLock = useRef(false);
  const unsavedSubmission = useRef<PoReceiveDraft['submitted']>(null);
  const [submissionSaveFailed, setSubmissionSaveFailed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
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
        const scope = await runtime.getScope();
        if (op?.scope === scope && op.status === 'confirmed') {
          const result = op.result as ReceivePurchaseOrderResult;
          const { target, quantity } = current.submitted;
          await draft.update((prev) =>
            prev.submitted?.key !== current.submitted?.key
              ? prev
              : {
                  ...prev,
                  active: null,
                  scanBump: 0,
                  quantity: null,
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
        } else if (op?.scope === scope && op.status === 'rejected') {
          await draft.update((prev) =>
            prev.submitted?.key === current.submitted?.key
              ? { ...prev, submitted: null }
              : prev
          );
        }
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

  const [putawayTarget, setPutawayTarget] = useState<PutawayTarget | null>(
    null
  );
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

  async function submitReceive() {
    if (
      !warehouseId ||
      !draft.ready ||
      !reconciled ||
      !arrivalsReady ||
      activeStateChanged ||
      submitLock.current ||
      quantity.isPending() ||
      (draft.error && !submissionSaveFailed) ||
      scanQueue.blocked()
    )
      return;
    submitLock.current = true;
    setSubmitting(true);
    let requestSaved = false;
    try {
      const current = normalizePoReceiveDraft(await draft.read());
      if (quantity.isPending() || scanQueue.blocked()) return;
      const target = current.submitted?.target ?? current.active;
      if (!target) return;
      const savedQuantity =
        current.submitted?.quantity ??
        parseQuantity(current.quantity?.text ?? '', 1, target.outstandingQty);
      if (savedQuantity == null) return;
      const submission = current.submitted ??
        unsavedSubmission.current ?? {
          target,
          quantity: savedQuantity,
          key: crypto.randomUUID(),
        };
      unsavedSubmission.current = submission;
      if (!current.submitted)
        await draft.update((prev) => ({ ...prev, submitted: submission }));
      requestSaved = true;
      unsavedSubmission.current = null;
      setSubmissionSaveFailed(false);
      const result = await receive.mutateAsync({
        poId,
        warehouseId,
        lines: [
          { skuId: submission.target.skuId, quantity: submission.quantity },
        ],
        idempotencyKey: submission.key,
      });
      // The runtime reconciles the original key. The runtime-free embedding uses the mutation result.
      if (!runtime) {
        await draft.update((prev) => ({
          ...prev,
          active: null,
          quantity: null,
          scanBump: 0,
          submitted: null,
          fresh: {
            lineId: result.lines[0].receiptLineId,
            skuId: submission.target.skuId,
            skuName: submission.target.skuName,
            skuCode: submission.target.skuCode,
            quantity: submission.quantity,
            putawayDoneQty: 0,
          },
        }));
      }
    } catch {
      if (!requestSaved) setSubmissionSaveFailed(true);
      // The mutation and draft hooks expose recoverable failures in the open sheet.
    } finally {
      submitLock.current = false;
      setSubmitting(false);
    }
  }

  const scanQueue = useWorkScanQueue<string>(async (code, eventId) => {
    await waitForScanReadiness();
    await quantity.waitUntilSaved();
    const beforeLookup = await draft.read();
    if (beforeLookup.seen.includes(eventId)) return;
    assertScanCanApply(beforeLookup);
    const skus = await lookup.mutateAsync(code);
    const sku = skus[0];
    await waitForScanReadiness();
    await quantity.waitUntilSaved();
    const current = await draft.read();
    if (current.seen.includes(eventId)) return;
    assertScanCanApply(current);
    const matched = sku
      ? linesRef.current.find((line) => line.skuId === sku.id)
      : undefined;
    if (!sku) {
      if (current.active) throw new PoReceiveBarcodeNotFoundError();
      setNotice('이 발주에 없는 품목이에요.');
      return;
    }
    if (!matched) {
      if (current.active) throw new PoReceiveSkuNotInOrderError();
      setNotice('이 발주에 없는 품목이에요.');
      return;
    }
    const step = scanIncrement(sku, code);
    if (current.active && current.active.skuId !== sku.id) {
      throw new PoReceiveDifferentSkuError();
    }
    if (current.submitted)
      throw new Error('먼저 저장된 입고 요청을 확인해 주세요.');
    // Validate before the storage reducer so an editable quantity error is not a storage failure.
    scanReceiptQuantity(
      normalizePoReceiveDraft(current).quantity ?? {
        text: String(matched.outstandingQty),
        source: 'suggested',
      },
      step
    );
    setNotice(null);
    await draft.update((saved) => {
      const prev = normalizePoReceiveDraft(saved);
      if (prev.seen.includes(eventId)) return prev;
      const nextQuantity = scanReceiptQuantity(
        prev.quantity ?? {
          text: String(matched.outstandingQty),
          source: 'suggested',
        },
        step
      );
      return {
        ...prev,
        active: prev.active ?? matched,
        quantity: nextQuantity,
        // Retain the legacy tally; only quantity drives display, edits and submission.
        scanBump: prev.active ? prev.scanBump + step : step,
        seen: [...prev.seen, eventId],
      };
    });
  }, `po-inbound:${warehouseId}:${poId}`);
  useScanner((e) => {
    if (putawayTarget) return;
    if (
      cancelConfirm ||
      receive.isPending ||
      submitLock.current ||
      unsavedSubmission.current ||
      !draft.ready
    ) {
      setNotice('현재 작업을 마친 뒤 다시 찍어 주세요.');
      return;
    }
    scanQueue.enqueue(e.code);
  });

  async function closeSheet() {
    await draft.update((prev) => ({
      ...prev,
      active: null,
      quantity: null,
      scanBump: 0,
    }));
  }

  const canDiscardInput =
    !draft.value.submitted &&
    !quantity.pending &&
    !submissionSaveFailed &&
    !submitting &&
    scanQueue.ready &&
    scanQueue.size() === 0 &&
    !scanQueue.error() &&
    !draft.error;
  async function discardDraftInput() {
    const current = await draft.read();
    if (
      current.submitted ||
      quantity.isPending() ||
      submitLock.current ||
      unsavedSubmission.current ||
      !scanQueue.ready ||
      scanQueue.size() > 0 ||
      scanQueue.error() ||
      draft.error
    )
      return;
    await closeSheet();
  }
  const recoveryLock = useRef(false);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [recoveryActionError, setRecoveryActionError] = useState<string | null>(
    null
  );
  const scanError = scanQueue.error();
  useEffect(() => setRecoveryActionError(null), [scanError]);
  async function runScanRecovery(
    action: () => Promise<void>,
    failureMessage: string
  ) {
    if (recoveryLock.current) return;
    recoveryLock.current = true;
    setRecoveryBusy(true);
    setRecoveryActionError(null);
    try {
      await action();
    } catch {
      setRecoveryActionError(failureMessage);
    } finally {
      recoveryLock.current = false;
      setRecoveryBusy(false);
    }
  }
  const scanRecovery = scanError ? (
    <ReceiveScanRecovery
      message={
        scanQueue.storageError()
          ? SCAN_STORAGE_MESSAGE
          : (recoveryActionError ??
            (scanError instanceof PoReceiveConfirmedUnappliedError ||
            scanError instanceof PoReceiveQuantityError
              ? scanError.message
              : '상품을 확인하지 못했어요. 다시 확인해 주세요.'))
      }
      busy={recoveryBusy || quantity.saveFailed}
      canRetry={
        !(scanError instanceof PoReceiveConfirmedUnappliedError) ||
        scanError instanceof PoReceiveScanNotAppliedError
      }
      canExclude={
        scanError instanceof PoReceiveConfirmedUnappliedError &&
        !draft.value.submitted
      }
      onRetry={() =>
        void runScanRecovery(
          () => scanQueue.retryHead(),
          '상품을 다시 확인하지 못했어요. 잠시 후 다시 확인해 주세요.'
        )
      }
      onExclude={() =>
        void runScanRecovery(
          () => scanQueue.rejectHead(),
          '이 스캔을 제외하지 못했어요. 저장 공간을 확인한 뒤 다시 시도해 주세요.'
        )
      }
    />
  ) : null;
  const discardInput =
    activeItem && canDiscardInput ? (
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
    <div className="space-y-4" aria-busy={!draft.ready || !reconciled}>
      <ScreenHeader
        title={purchaseOrder?.supplier?.name ?? '발주 입고'}
        backTo="/inbound"
      />

      {draft.error ? (
        <p role="alert">작업을 저장하지 못했어요. 저장 공간을 확인해 주세요.</p>
      ) : null}
      {!activeItem ? scanRecovery : null}
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
            {receipt.ready && receipt.state ? (
              receipt.state.canceledQty > 0 ||
              receipt.state.receiptStatus === 'voided' ? (
                <>
                  {fresh.skuName} <span>취소됨</span>
                </>
              ) : (
                <>
                  <span>
                    {fresh.skuName} {receipt.state.quantity}개 입고됨
                  </span>
                  {receipt.state.putawayFromOriginQty === receipt.state.quantity
                    ? ' · 적치 완료'
                    : receipt.state.returnedQty > 0
                      ? ` · 잔여 ${receipt.state.pendingQty}개 · ${receipt.state.putawayFromOriginQty}개 적치됨 · ${receipt.state.returnedQty}개 회송됨`
                      : receipt.state.putawayFromOriginQty > 0
                        ? ` · 잔여 ${receipt.state.pendingQty}개 · ${receipt.state.putawayFromOriginQty}개 적치됨`
                        : ''}
                </>
              )
            ) : (
              ' · 입고 상태 확인 필요'
            )}
          </p>
          <div className="flex gap-2">
            {receipt.ready &&
            receipt.state?.canPutaway &&
            receipt.state.originLocationId ? (
              <Button
                type="button"
                className="flex-1 py-1.5 text-xs"
                disabled={!reconciled || !!draft.error}
                onClick={() => {
                  if (receipt.state?.originLocationId)
                    setPutawayTarget({
                      lineId: fresh.lineId,
                      skuName: fresh.skuName,
                      skuCode: fresh.skuCode,
                      source: 'purchase_order',
                      pendingQty: receipt.state.pendingQty,
                      originLocationId: receipt.state.originLocationId,
                      originLocationCode:
                        receipt.state.originLocationCode ?? '원위치',
                    });
                }}
              >
                적치하기
              </Button>
            ) : null}
            {/* 취소는 적치 전에만 가능하다 — 서버가 putawayFromOriginQty > 0 이면 거부한다.
                부분 적치도 그 조건에 걸리므로 누계가 0 일 때만 노출한다.
                확인 다이얼로그가 뜬 동안은 감춘다 — 다이얼로그도 [취소] 버튼을 쓰므로
                접근성 이름이 겹치고, 배너 쪽은 어차피 조작할 대상이 아니다. */}
            {receipt.ready && receipt.state?.canCancel && !cancelConfirm ? (
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
          {!receipt.ready && (
            <div>
              <p role="status">입고 상태를 확인해 주세요.</p>
              <Button onClick={() => void receipt.refresh().catch(() => {})}>
                다시 확인
              </Button>
            </div>
          )}
          {(followupError || receipt.error) && (
            <p role="alert">
              {followupError ?? receiptFeedback(receipt.error, 'inbound')}
            </p>
          )}
          {cancel.isError ? (
            <p role="alert" className="text-xs text-red-700">
              {errorMessage(cancel.error, 'inbound-cancel')}
            </p>
          ) : null}
        </div>
      ) : null}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-gray-700">발주 품목</h2>
        {!activeItem && !arrivalsReady ? (
          sheetStatus
        ) : arrivals.isError ? (
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
                      if (
                        !draft.ready ||
                        quantity.isPending() ||
                        scanQueue.blocked() ||
                        submitLock.current
                      )
                        return;
                      void draft
                        .update((prev) => ({
                          ...prev,
                          active: item,
                          scanBump: 0,
                          quantity: {
                            text: String(item.outstandingQty),
                            source: 'suggested',
                          },
                        }))
                        .catch(() => {});
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
          quantityText={
            draft.value.submitted
              ? String(draft.value.submitted.quantity)
              : quantity.text
          }
          getQuantityText={quantity.getText}
          onQuantityChange={(text) => {
            if (
              submitLock.current ||
              unsavedSubmission.current ||
              recoveryLock.current ||
              draft.value.submitted ||
              quantity.saveFailed ||
              draft.error ||
              !draft.ready ||
              !reconciled ||
              !arrivalsReady ||
              activeStateChanged ||
              (scanQueue.blocked() &&
                !(scanQueue.error() instanceof PoReceiveQuantityError))
            )
              return;
            quantity.change(text);
          }}
          submitDisabled={
            receive.isPending ||
            submitting ||
            quantity.pending ||
            !!draft.error ||
            scanQueue.blocked() ||
            !draft.ready ||
            !reconciled ||
            !arrivalsReady ||
            activeStateChanged
          }
          inputDisabled={
            !!draft.value.submitted ||
            submissionSaveFailed ||
            receive.isPending ||
            submitting ||
            recoveryBusy ||
            !!draft.error ||
            quantity.saveFailed ||
            !draft.ready ||
            !reconciled ||
            !arrivalsReady ||
            activeStateChanged ||
            (scanQueue.blocked() &&
              !(scanError instanceof PoReceiveQuantityError))
          }
          cancelDisabled={!canDiscardInput}
          error={
            receive.isError ? errorMessage(receive.error, 'po-receive') : null
          }
          statusContent={sheetStatus}
          recovery={
            <>
              {submissionSaveFailed ? (
                <div className="space-y-2" role="alert">
                  <p>
                    입고 요청을 저장하지 못했어요. 수량을 유지한 채 다시 시도해
                    주세요.
                  </p>
                  <Button
                    type="button"
                    disabled={submitting}
                    onClick={() => void submitReceive()}
                  >
                    입고 요청 저장 다시 시도
                  </Button>
                </div>
              ) : null}
              {quantity.saveFailed ? (
                <div className="space-y-2" role="alert">
                  <p>
                    수량을 저장하지 못했어요. 입력한 수량을 유지하고 있어요.
                  </p>
                  <Button type="button" onClick={() => void quantity.retry()}>
                    저장 다시 시도
                  </Button>
                </div>
              ) : quantity.pending ? (
                <p role="status">수량을 저장하고 있어요.</p>
              ) : null}
              {scanRecovery}
            </>
          }
          onCancel={() => void discardDraftInput()}
          onSubmit={() => void submitReceive()}
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
        onConfirm={async () => {
          if (!fresh || followupLock.current) return;
          followupLock.current = true;
          setCancelConfirm(false);
          setFollowupError(null);
          try {
            const latest = await receipt.refresh();
            if (!latest.canCancel || latest.quantity !== fresh.quantity) {
              setFollowupError(
                '입고 상태가 바뀌었어요. 최신 내역을 확인해 주세요.'
              );
              return;
            }
            await cancel.mutateAsync({
              receiptLineId: latest.lineId,
              idempotencyKey: cancelKeyFor(latest.lineId),
            });
            await receipt.refresh();
          } catch (error) {
            setFollowupError(receiptFeedback(error, 'inbound-cancel'));
          } finally {
            followupLock.current = false;
          }
        }}
      />

      {putawayTarget ? (
        <PutawaySheet
          target={putawayTarget}
          warehouseId={warehouseId}
          lastDest={lastDest}
          onCancel={() => setPutawayTarget(null)}
          onDone={async (dest) => {
            setLastDest(dest);
            setPutawayTarget(null);
            await receipt.refresh().catch(() => {});
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
