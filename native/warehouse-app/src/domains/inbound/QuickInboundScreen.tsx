import { assertInboundWorkflowCapability } from '../../core/operations/useWorkCapabilities';
import { useSession } from '../../app/session-context';
import { Link } from '@tanstack/react-router';
import { useApiClient } from '../../core/data/ApiClientProvider';
import { receiptHistoryPath, validateReceiptHistory } from './receiptHistory';
import { useWorkRuntime } from '../../core/operations/OperationContext';
import type { SimpleInboundResult } from './types';
import {
  WorkArea,
  useWorkAreaBlocked,
} from '../../core/operations/WorkBoundary';
import { useEffect, useRef, useState } from 'react';
import { CircleCheck, Trash2 } from 'lucide-react';
import { useWorkDraft } from '../../core/operations/useWorkDraft';
import { useWarehouse } from '../../app/warehouse-context';
import { errorMessage } from '../../core/data/errorMessage';
import { ApiError, NetworkError } from '../../core/data/httpClient';
import { Button } from '../../core/design/Button';
import { parseQuantity } from '../../core/design/QuantityInput';
import { SkuThumbnail } from '../inventory/SkuInfoSheet';
import type { SkuSearchItem } from '../inventory/types';
import { QuickCatalog, A_SMALL_BUTTON } from './QuickCatalog';
import { InboundTabs } from './InboundTabs';
import { Kbd } from '../../station/Kbd';
import { BarcodeInput } from '../../core/hardware/scan/BarcodeInput';
import { useUnsavedWork } from '../../core/operations/useUnsavedWork';
import { ScreenHeader } from '../../core/design/ScreenHeader';
import {
  SCAN_STORAGE_MESSAGE,
  useWorkScanQueue,
} from '../../core/hardware/scan/useWorkScanQueue';
import { useScanner } from '../../core/hardware/scan/useScanner';
import { WarehousePicker } from '../warehouse/WarehousePicker';
import { useSkuByBarcode } from '../inventory/useSkuByBarcode';
import { scanIncrement } from './packingUnit';
import { useSimpleInbound } from './mutations';
import { workSummary } from '../../core/operations/pendingWork';
import { usualShelfNotice } from './RememberUsualToggle';
import {
  playInboundSaved,
  playInboundSaveFailed,
  primeInboundSaveSound,
} from './saveFeedback';
import { inboundToastDetail, SaveToast, useSaveToast } from './SaveToast';
import { PutawaySheet, type LocationRef } from './PutawaySheet';
import { useWaitingOrders } from './waitingOrders';
import {
  CancelReceiptDialog,
  type CancelReceiptTarget,
} from './CancelReceiptDialog';
import { ReadyShipmentsSection } from './ReadyShipmentsSection';
import { QuickQuantitySheet } from './QuickQuantitySheet';
import { useStationActions } from '../../station/ActionRegistry';
import type { StationAction } from '../../station/actions';
import { WaitingOrdersFailed, WaitingOrdersNote } from './WaitingOrdersNote';
import type { FreshLine, PutawayTarget } from './types';

/** 이전 입고 결과를 확인하다 멈춘 이유 — 그대로 작업자에게 보여 준다. */
class CheckStop extends Error {}

function failureText(error: unknown, fallback: string) {
  if (error instanceof CheckStop) return error.message;
  if (error instanceof ApiError || error instanceof NetworkError)
    return errorMessage(error, 'inbound');
  return fallback;
}

const NO_ACTIONS: readonly StationAction[] = [];

const PANEL =
  'min-w-0 overflow-hidden rounded-xl border border-[#e4e4e7] bg-white';
const PANEL_HEAD =
  'flex items-center justify-between gap-2.5 border-b border-[#e4e4e7] px-[22px] py-[19px]';
const THUMB = 'h-[53px] w-[44px] shrink-0 rounded-[7px] bg-[#f4f4f5]';
const PILL =
  'inline-flex shrink-0 items-center rounded-[5px] px-2 py-[5px] text-xs font-semibold whitespace-nowrap';
const OUTLINE_BUTTON =
  'inline-flex items-center justify-center rounded-lg border border-[#e4e4e7] bg-white px-4 py-[11px] text-sm font-semibold text-[#27272a] hover:bg-[#eff6ff] hover:brightness-100 disabled:opacity-40';
const STATUS_BOX =
  'rounded-[10px] border border-[#e4e4e7] bg-white px-4 py-3 text-[13px] text-[#71717a]';
const WARN_BOX =
  'rounded-[10px] border border-[#f0dcb4] bg-[#fffaf0] px-4 py-3 text-[13px] text-[#9a681c]';
const ERROR_BOX =
  'rounded-[10px] border border-[#efcbc4] bg-[#fff4f1] px-4 py-3 text-[13px] text-[#aa4037]';

interface CartRow {
  skuId: string;
  skuCode: string;
  skuName: string;
  optionKey?: string | null;
  imageFileIds?: string[];
  quantity: number;
}

function QuickInboundScreenContent({ station }: { station: boolean }) {
  const { warehouseId, isSet } = useWarehouse();
  const lookup = useSkuByBarcode();
  const api = useApiClient();
  const submit = useSimpleInbound();
  const toast = useSaveToast();
  const cartRef = useRef<HTMLElement>(null);

  const initialDraft = useRef({
    receiptId: null as string | null,
    cart: [] as CartRow[],
    staged: [] as FreshLine[],
    seen: [] as string[],
    key: crypto.randomUUID(),
  });
  const draft = useWorkDraft(
    `quick-inbound:${warehouseId}`,
    initialDraft.current
  );
  const { cart, staged, key: idempotencyKey } = draft.value;
  const setCart = (reduce: CartRow[] | ((prev: CartRow[]) => CartRow[])) =>
    draft.update((prev) => ({
      ...prev,
      cart: typeof reduce === 'function' ? reduce(prev.cart) : reduce,
      key: crypto.randomUUID(),
    }));
  const runtime = useWorkRuntime();
  const session = useSession();
  const [receivedAt, setReceivedAt] = useState<string | null>(null);
  const [currentLines, setCurrentLines] = useState<
    import('./receiptHistory').ReceiptHistoryLine[]
  >([]);
  const [reconciled, setReconciled] = useState(!runtime);
  const [checkFailure, setCheckFailure] = useState<string | null>(null);
  const reconcileRef = useRef<(() => Promise<void>) | null>(null);
  const reconciliation = useRef<Promise<void> | null>(null);
  // 저장된 스캔이 화면 준비보다 먼저 복원되면 확인이 시작될 때까지 기다린다.
  const [reconcileStarted] = useState(() => {
    let start!: () => void;
    const started = new Promise<void>((resolve) => (start = resolve));
    return { started, start };
  });
  useEffect(() => {
    if (!runtime || !draft.ready) return;
    let live = true;
    let generation = 0;
    const reconcile = async () => {
      const thisGeneration = ++generation;
      if (live) {
        setReconciled(false);
        setCheckFailure(null);
      }
      try {
        await check(thisGeneration);
      } catch (error) {
        if (live && thisGeneration === generation)
          setCheckFailure(
            failureText(error, '입고내역에서 상태를 확인해 주세요.')
          );
        throw error;
      }
    };
    const check = async (thisGeneration: number) => {
      const scope = await runtime.getScope();
      const current = await draft.read();
      const op = await runtime.store.get(current.key);
      if (op && op.scope !== scope)
        throw new CheckStop('로그인을 다시 확인해 주세요.');
      if (op && op.status !== 'confirmed' && op.status !== 'rejected')
        throw new CheckStop('입고 처리 여부를 먼저 확인해 주세요.');
      if (op?.status === 'confirmed' && current.staged.length === 0) {
        const result = op.result as SimpleInboundResult;
        await draft.update((prev) => ({
          ...prev,
          receiptId: result.id,
          staged:
            prev.key !== current.key || prev.staged.length > 0
              ? prev.staged
              : result.lines.map((line) => ({
                  lineId: line.id,
                  skuId: line.skuId,
                  skuName:
                    prev.cart.find((row) => row.skuId === line.skuId)
                      ?.skuName ?? '',
                  skuCode:
                    prev.cart.find((row) => row.skuId === line.skuId)
                      ?.skuCode ?? '',
                  quantity: line.quantity,
                  putawayDoneQty: 0,
                })),
        }));
      }
      const latest = await draft.read();
      const receiptId =
        latest.receiptId ??
        (op?.status === 'confirmed'
          ? (op.result as SimpleInboundResult).id
          : undefined);
      let historyLines: import('./receiptHistory').ReceiptHistoryLine[] = [];
      let receivedAt: string | null = null;
      if (latest.staged.length) {
        if ((await runtime.store.pending(scope)).length)
          throw new CheckStop('처리 내역을 먼저 확인해 주세요.');
        await assertInboundWorkflowCapability(runtime);
        if (!receiptId || !warehouseId)
          throw new CheckStop('입고내역에서 상태를 확인해 주세요.');
        const history = await api.request<unknown>({
          path: receiptHistoryPath({
            warehouseId,
            receiptId,
            status: 'all',
            limit: 1,
            offset: 0,
          }),
        });
        validateReceiptHistory(history);
        const receipt = history.items.find(
          (item) => item.id === receiptId && item.warehouseId === warehouseId
        );
        if (
          !receipt ||
          latest.staged.some(
            (line) => !receipt.lines.some((item) => item.id === line.lineId)
          )
        )
          throw new CheckStop('입고내역을 확인해 주세요.');
        historyLines = receipt.lines;
        receivedAt = receipt.occurredAt;
      }
      if (
        !live ||
        thisGeneration !== generation ||
        !session.isAuthenticated() ||
        (await runtime.getScope()) !== scope
      )
        return;
      if ((await runtime.store.pending(scope)).length)
        throw new CheckStop('처리 내역을 먼저 확인해 주세요.');
      if (!live || thisGeneration !== generation) return;
      setCurrentLines(historyLines);
      setReceivedAt(receivedAt);
      if (live && thisGeneration === generation) setReconciled(true);
    };
    const runReconcile = () => {
      const pending = reconcile();
      reconciliation.current = pending;
      reconcileStarted.start();
      return pending;
    };
    reconcileRef.current = runReconcile;
    void runReconcile().catch(() => {});
    const off = runtime.runner.subscribe(
      () => void runReconcile().catch(() => {})
    );
    const offSession = session.subscribe(() => {
      ++generation;
      setCurrentLines([]);
      setReconciled(false);
      void runReconcile().catch(() => {});
    });
    return () => {
      live = false;
      offSession();
      off();
    };
  }, [runtime, draft.ready, api, warehouseId, session, reconcileStarted]);
  const [editing, setEditing] = useState<string | null>(null);
  const [quantityText, setQuantityText] = useState('');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  // 화면이 준비되기 전에 찍힌 스캔 — 준비가 끝나면 차례대로 담는다.
  const held = useRef<string[]>([]);
  const [heldCount, setHeldCount] = useState(0);
  useUnsavedWork(
    editing !== null ||
      saving ||
      heldCount > 0 ||
      (!reconciled && cart.length > 0 && staged.length === 0)
  );
  const [notice, setNotice] = useState<string | null>(null);
  const editingRow = cart.find((row) => row.skuId === editing) ?? null;

  const [putawayFor, setPutawayFor] = useState<PutawayTarget | null>(null);
  const [cancelFor, setCancelFor] = useState<CancelReceiptTarget | null>(null);
  const [lastDest, setLastDest] = useState<LocationRef | null>(null);
  // 적치 대기 목록으로 넘어간 뒤에는 스캔이 카트를 건드리면 안 된다.
  const stagedMode = staged.length > 0;
  const waiting = useWaitingOrders(
    warehouseId,
    (stagedMode ? staged : cart).map((row) => row.skuId)
  );

  // 저장된 작업을 못 읽었거나 이전 입고 결과를 확인하지 못했다 — 기다려도 준비되지 않는다.
  const loadFailed = !draft.ready && !!draft.error;
  const prepFailure =
    checkFailure ??
    (loadFailed
      ? failureText(draft.error, '연결을 확인한 뒤 다시 확인해 주세요.')
      : null);
  async function retryPrep() {
    if (loadFailed) {
      draft.reload();
      if (scanQueue.storageError()) await scanQueue.retryHead();
      return;
    }
    await reconcileRef.current?.();
  }
  // 서버 연결이 끊기면 작업 영역 전체가 잠기고 그 안내의 「처리 내역 확인」이 연결을 다시 본다.
  // 잠금이 풀리면 이 화면의 준비도 이어서 다시 한다 — 같은 확인을 두 번 누르게 하지 않는다.
  const areaBlocked = useWorkAreaBlocked('inbound');
  const wasBlocked = useRef(areaBlocked);
  const retryAfterUnblock = useRef<(() => Promise<void>) | null>(null);
  retryAfterUnblock.current = prepFailure ? retryPrep : null;
  useEffect(() => {
    const was = wasBlocked.current;
    wasBlocked.current = areaBlocked;
    if (was && !areaBlocked) void retryAfterUnblock.current?.().catch(() => {});
  }, [areaBlocked]);

  const scanQueue = useWorkScanQueue<string>(async (code, eventId) => {
    // Restored physical inputs must wait for the original receipt result too.
    if (runtime) {
      if (!reconciliation.current) await reconcileStarted.started;
      await reconciliation.current;
    }
    const skus = await lookup.mutateAsync(code);
    const sku = skus[0];
    if (!sku) {
      setNotice('등록되지 않은 바코드예요.');
      return;
    }
    const step = scanIncrement(sku, code);
    setNotice(null);
    await draft.update((prev) => {
      if (prev.seen.includes(eventId)) return prev;
      if (prev.staged.length > 0)
        throw new Error('이미 입고된 작업이에요. 입고내역을 확인해 주세요.');
      const found = prev.cart.find((r) => r.skuId === sku.id);
      const cart = found
        ? prev.cart.map((r) =>
            r.skuId === sku.id ? { ...r, quantity: r.quantity + step } : r
          )
        : [
            ...prev.cart,
            {
              skuId: sku.id,
              skuCode: sku.code,
              skuName: sku.name,
              optionKey: sku.optionKey,
              imageFileIds: sku.imageFileIds,
              quantity: step,
            },
          ];
      return {
        ...prev,
        cart,
        seen: [...prev.seen, eventId],
        key: crypto.randomUUID(),
      };
    });
  }, `quick-inbound:${warehouseId}`);
  const enqueueScan = useRef(scanQueue.enqueue);
  enqueueScan.current = scanQueue.enqueue;
  useScanner((e) => {
    if (putawayFor) return;
    if (stagedMode || submit.isPending || editing || savingRef.current) {
      setNotice('현재 작업을 마친 뒤 다시 찍어 주세요.');
      return;
    }
    if (prepFailure) {
      setNotice('입고 상태를 확인한 뒤 다시 찍어 주세요.');
      return;
    }
    if (!draft.ready || !reconciled) {
      held.current.push(e.code);
      setHeldCount(held.current.length);
      return;
    }
    scanQueue.enqueue(e.code);
  });
  useEffect(() => {
    if (held.current.length === 0) return;
    if (prepFailure) {
      held.current = [];
      setHeldCount(0);
      setNotice(
        '준비를 마치지 못해 찍은 상품을 담지 못했어요. 입고 상태를 확인한 뒤 다시 찍어 주세요.'
      );
      return;
    }
    if (!draft.ready || !reconciled) return;
    const codes = held.current;
    held.current = [];
    setHeldCount(0);
    if (stagedMode) {
      setNotice(
        '이미 등록한 입고라 찍은 상품을 담지 않았어요. 새 입고를 시작한 뒤 다시 찍어 주세요.'
      );
      return;
    }
    codes.forEach((code) => enqueueScan.current(code));
  }, [draft.ready, reconciled, prepFailure, stagedMode, heldCount]);

  async function chooseSku(sku: SkuSearchItem) {
    if (
      !reconciled ||
      !draft.ready ||
      stagedMode ||
      savingRef.current ||
      editing ||
      scanQueue.blocked() ||
      submit.isPending
    )
      return;
    savingRef.current = true;
    setSaving(true);
    try {
      const current = await draft.read();
      const row = current.cart.find((item) => item.skuId === sku.id);
      if (!row)
        await setCart((prev) => [
          ...prev,
          {
            skuId: sku.id,
            skuCode: sku.code,
            skuName: sku.name,
            optionKey: sku.optionKey,
            imageFileIds: sku.imageFileIds,
            quantity: 1,
          },
        ]);
      setNotice(null);
      setQuantityText(String(row?.quantity ?? 1));
      setEditing(sku.id);
    } catch {
      setNotice(
        '상품을 저장하지 못했어요. 저장 공간을 확인한 뒤 다시 선택해 주세요.'
      );
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }
  async function saveQuantity() {
    const quantity = parseQuantity(quantityText, 1);
    if (!reconciled || !editing || quantity === null || savingRef.current)
      return;
    savingRef.current = true;
    setSaving(true);
    try {
      await setCart((prev) =>
        prev.map((row) => (row.skuId === editing ? { ...row, quantity } : row))
      );
      setEditing(null);
    } catch {
      setNotice(
        '수량을 저장하지 못했어요. 입력을 유지한 채 다시 저장해 주세요.'
      );
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  const cartTotal = cart.reduce((sum, row) => sum + row.quantity, 0);
  const canRegister = !(
    !reconciled ||
    !!editing ||
    saving ||
    !draft.ready ||
    !!draft.error ||
    scanQueue.blocked() ||
    cart.length === 0 ||
    cart.some((r) => r.quantity < 1) ||
    submit.isPending
  );

  function register() {
    if (!canRegister || !warehouseId) return;

    primeInboundSaveSound();
    submit.mutate(
      {
        warehouseId,
        items: cart.map((r) => ({
          skuId: r.skuId,
          quantity: r.quantity,
        })),
        idempotencyKey,
        summary: workSummary(
          cart.map((r) => ({ name: r.skuName, quantity: r.quantity }))
        ),
      },
      {
        onError: () => playInboundSaveFailed(),
        onSuccess: async (result) => {
          playInboundSaved();
          toast.show({
            kind: 'saved',
            detail: inboundToastDetail(
              cart.map((r) => ({ name: r.skuName, quantity: r.quantity }))
            ),
          });

          // 응답 lines[] 를 카트 행과 skuId 로 맞춰 이름을 되살린다.
          await draft.update((prev) => ({
            ...prev,
            receiptId: result.id,
            staged: result.lines.map((line) => {
              const row = cart.find((r) => r.skuId === line.skuId);
              return {
                lineId: line.id,
                skuId: line.skuId,
                skuCode: row?.skuCode ?? '',
                skuName: row?.skuName ?? '',
                quantity: line.quantity,
                putawayDoneQty: 0,
              };
            }),
          }));
        },
      }
    );
  }

  useStationActions(
    stagedMode
      ? NO_ACTIONS
      : [
          {
            id: 'quick-inbound-register',
            key: 'F10',
            label: '입고 등록',
            enabled: canRegister,
            run: register,
          },
        ]
  );

  const registerError = submit.isError ? (
    <p role="alert" className="text-[13px] text-[#aa4037]">
      {errorMessage(submit.error, 'inbound')}
    </p>
  ) : null;

  const registerButton = (
    <Button
      type="button"
      className={station ? 'w-full gap-2 py-[15px]' : 'shrink-0 gap-2'}
      disabled={!canRegister}
      onClick={register}
    >
      {cart.length > 0
        ? `${cart.length}종 ${cartTotal}개 입고 등록`
        : '입고 등록'}
      {station ? (
        <span aria-hidden>
          <Kbd tone="outline">F10</Kbd>
        </span>
      ) : null}
    </Button>
  );

  const header = (
    <ScreenHeader
      title="입고"
      backTo="/inbound"
      description="상품을 확인하고 수량을 담아 한 번에 등록하세요."
      right={<InboundTabs active="quick" />}
    />
  );

  if (!isSet) {
    return (
      <div className="space-y-[22px]">
        {header}
        <div className="space-y-3 rounded-xl border border-dashed border-[#e4e4e7] bg-white p-5">
          <p className="text-[13px] text-[#71717a]">창고를 먼저 선택해 주세요.</p>
          <WarehousePicker />
        </div>
      </div>
    );
  }

  const stagedTotal = staged.reduce((sum, row) => sum + row.quantity, 0);

  return (
    <div className="space-y-[22px]" aria-busy={!draft.ready || !reconciled}>
      <SaveToast toast={toast.toast} />
      {header}

      {!stagedMode && !prepFailure && (!draft.ready || !reconciled) ? (
        <p role="status" className={STATUS_BOX}>
          스캔 준비 중이에요. 잠시만 기다려 주세요.
          {heldCount > 0
            ? ` 찍은 상품 ${heldCount}건은 준비가 끝나면 담아요.`
            : null}
        </p>
      ) : null}
      {prepFailure ? (
        <p role="alert" className={`space-y-2 ${WARN_BOX}`}>
          <span className="block">
            입고 상태를 확인하지 못했어요. {prepFailure}
          </span>
          <Button onClick={() => void retryPrep().catch(() => {})}>
            입고 상태 다시 확인
          </Button>
        </p>
      ) : null}
      {draft.error && !loadFailed ? (
        <p role="alert" className={ERROR_BOX}>
          작업을 저장하지 못했어요. 저장 공간을 확인해 주세요.
        </p>
      ) : null}
      {scanQueue.error() && !(loadFailed && scanQueue.storageError()) ? (
        <p
          role="alert"
          className={`flex flex-wrap items-center gap-2 ${ERROR_BOX}`}
        >
          {scanQueue.storageError()
            ? SCAN_STORAGE_MESSAGE
            : '상품을 확인하지 못했어요.'}{' '}
          <Button
            className={A_SMALL_BUTTON}
            onClick={() => void scanQueue.retryHead().catch(() => {})}
          >
            다시 확인
          </Button>
        </p>
      ) : null}
      {notice && !editingRow ? (
        <p role="alert" className={WARN_BOX}>
          {notice}
        </p>
      ) : null}

      {stagedMode ? (
        <section
          className={
            station
              ? 'grid items-start gap-6 min-[901px]:grid-cols-[1.1fr_.9fr]'
              : 'space-y-[18px]'
          }
        >
          <div className="min-w-0 space-y-[18px]">
            <div className="flex items-center gap-[15px] rounded-[10px] bg-[#eff6ff] p-[25px]">
              <CircleCheck
                className="h-8 w-8 shrink-0 text-[#2563eb]"
                aria-hidden
              />
              <div className="min-w-0">
                <p className="text-lg font-bold text-[#27272a]">
                  입고 등록이 완료됐어요
                </p>
                <p className="mt-[5px] text-[13px] text-[#71717a]">
                  {staged.length}종 {stagedTotal}개 · 각 품목을 선반에
                  꽂으면서 대상 로케이션을 찍어 주세요.
                </p>
              </div>
            </div>
            <div className={PANEL}>
              <div className={PANEL_HEAD}>
                <h2 className="text-[15px] font-semibold text-[#27272a]">
                  적치 대기
                </h2>
                <WaitingOrdersFailed failed={waiting.failed} />
              </div>
              {!reconciled && !prepFailure && (
                <p role="alert" className={`m-4 ${WARN_BOX}`}>
                  입고 상태를 확인하고 있어요. 확인이 안 되면 입고내역 또는 적치
                  대기 목록에서 이어서 작업해 주세요.
                </p>
              )}
              <ul>
                {staged.map((saved) => {
                  const current = currentLines.find(
                    (item) => item.id === saved.lineId
                  );
                  const line = {
                    ...saved,
                    putawayDoneQty: current?.putawayFromOriginQty ?? 0,
                    canceledQty: current?.canceledQty ?? 0,
                    returnedQty: current?.returnedQty ?? 0,
                  };
                  const photo = cart.find(
                    (row) => row.skuId === line.skuId
                  )?.imageFileIds;

                  return (
                    <li
                      key={line.lineId}
                      className="flex items-center gap-3 border-b border-[#e4e4e7] px-[22px] py-3.5 last:border-b-0"
                    >
                      <SkuThumbnail fileIds={photo} className={THUMB} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] leading-[1.6] font-semibold text-[#27272a]">
                          {line.skuName}
                        </span>
                        <span className="block font-mono text-[11px] text-[#71717a]">
                          {line.skuCode}
                        </span>
                        {line.canceledQty > 0 ||
                        line.putawayDoneQty >= line.quantity ? null : (
                          <WaitingOrdersNote waiting={waiting.of(line.skuId)} />
                        )}
                        {/* 예정 입고 화면 배너와 같은 문구 — 부분 적치가 손대지 않은 라인과
                          시각적으로 구분되지 않는 문제를 막는다. */}
                        {line.putawayDoneQty > 0 &&
                        line.putawayDoneQty < line.quantity ? (
                          <span className="block text-[11px] text-[#71717a]">
                            잔여 {current?.pendingQty}개 · {line.putawayDoneQty}개
                            적치됨
                          </span>
                        ) : null}
                        {current?.putawayBlockReason ===
                          'ORIGIN_STOCK_INCONSISTENT' && (
                          <span className="block text-[11px] text-[#71717a]">
                            입고 기록과 현재 재고가 맞지 않아요. 입고내역과
                            실물을 확인해 주세요.
                          </span>
                        )}
                        {line.returnedQty > 0 && (
                          <span className="block text-[11px] text-[#71717a]">
                            {line.returnedQty}개 회송됨
                          </span>
                        )}
                      </span>
                      <span className="text-lg font-bold text-[#27272a] tabular-nums">
                        {line.quantity}
                      </span>
                      {current &&
                      receivedAt &&
                      line.canceledQty === 0 &&
                      line.putawayDoneQty < line.quantity ? (
                        <button
                          type="button"
                          className="shrink-0 rounded-lg px-2 py-[7px] text-xs text-[#71717a] hover:bg-[#f4f4f5] disabled:opacity-50"
                          disabled={!reconciled || !!draft.error}
                          onClick={() =>
                            setCancelFor({
                              lineId: line.lineId,
                              source: current.source,
                              skuName: line.skuName,
                              originLocationCode: current.originLocationCode,
                              receivedAt,
                            })
                          }
                        >
                          잘못 입고 · 취소
                        </button>
                      ) : null}
                      {(line.canceledQty ?? 0) > 0 ? (
                        <span className={`${PILL} bg-[#eff1f2] text-[#68706d]`}>
                          취소됨
                        </span>
                      ) : line.putawayDoneQty >= line.quantity ? (
                        <span className={`${PILL} bg-[#eff6ff] text-[#2563eb]`}>
                          완료
                        </span>
                      ) : current?.canPutaway || !reconciled ? (
                        <Button
                          className="shrink-0 px-2.5 py-[7px] text-xs"
                          disabled={
                            !reconciled ||
                            !!draft.error ||
                            !current?.canPutaway ||
                            !current.originLocationId
                          }
                          onClick={() => {
                            if (
                              current?.canPutaway &&
                              current.originLocationId &&
                              current.pendingQty !== undefined
                            )
                              setPutawayFor({
                                lineId: line.lineId,
                                skuId: line.skuId,
                                skuName: line.skuName,
                                skuCode: line.skuCode,
                                source: current.source,
                                pendingQty: current.pendingQty,
                                originLocationId: current.originLocationId,
                                originLocationCode:
                                  current.originLocationCode ?? '원위치',
                              });
                          }}
                        >
                          적치
                        </Button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link to="/inbound/history" className={OUTLINE_BUTTON}>
                입고내역 · 취소
              </Link>
              <Button
                type="button"
                className={OUTLINE_BUTTON}
                disabled={saving || !reconciled || !!draft.error}
                onClick={async () => {
                  if (!reconciled || savingRef.current) return;
                  savingRef.current = true;
                  setSaving(true);
                  try {
                    await draft.update(() => ({
                      receiptId: null,
                      cart: [],
                      staged: [],
                      seen: [],
                      key: crypto.randomUUID(),
                    }));
                  } catch {
                    setNotice('새 입고를 시작하지 못했어요. 다시 시도해 주세요.');
                  } finally {
                    savingRef.current = false;
                    setSaving(false);
                  }
                }}
              >
                새 입고 시작
              </Button>
            </div>
          </div>
          <div className="min-w-0">
            <ReadyShipmentsSection
              warehouseId={warehouseId}
              receiptLineIds={staged.map((row) => row.lineId)}
            />
          </div>
        </section>
      ) : (
        <section
          className={
            station
              ? 'grid items-start gap-[22px] min-[901px]:grid-cols-[minmax(400px,1.3fr)_minmax(330px,.8fr)]'
              : 'space-y-4'
          }
        >
          <div className="min-w-0 space-y-[17px]">
            <QuickCatalog
              warehouseId={warehouseId}
              disabled={
                !draft.ready ||
                !reconciled ||
                saving ||
                !!editing ||
                scanQueue.blocked() ||
                submit.isPending
              }
              onSelect={(sku) => void chooseSku(sku)}
            />
            <div className="rounded-[10px] border border-[#e4e4e7] bg-white px-[15px] py-3 text-[13px] text-[#71717a]">
              <BarcodeInput
                disabled={
                  !draft.ready ||
                  !reconciled ||
                  saving ||
                  !!editing ||
                  submit.isPending
                }
                onSubmit={(code) => scanQueue.enqueue(code)}
              />
            </div>
            <WaitingOrdersFailed failed={waiting.failed} />
            <p className="px-0.5 text-xs text-[#71717a]">
              발주 상품은 예정 입고에서 등록해 주세요. 수량은 낱개 기준이에요.
            </p>
          </div>

          <aside
            ref={cartRef}
            aria-label="담은 상품"
            className={
              station
                ? `sticky top-0 flex max-h-[calc(100vh-11rem)] min-h-[450px] flex-col ${PANEL}`
                : `scroll-mb-28 ${PANEL}`
            }
          >
            <div className={PANEL_HEAD}>
              <h2 className="flex items-center gap-2 text-[15px] font-semibold text-[#27272a]">
                담은 상품
                <span className="rounded-[5px] bg-[#eff6ff] px-[7px] py-1 text-xs font-normal text-[#2563eb]">
                  {cart.length}
                </span>
              </h2>
              <small className="text-xs text-[#71717a]">아직 등록 전</small>
            </div>
            <div
              className={
                station
                  ? 'min-h-[120px] flex-1 overflow-y-auto px-5 py-0.5'
                  : 'px-5 py-0.5'
              }
            >
              {!draft.ready ? null : cart.length === 0 ? (
                <p className="px-5 py-[60px] text-center text-sm text-[#71717a]">
                  검색한 상품을 선택하거나
                  <br />
                  바코드를 스캔해 주세요.
                </p>
              ) : (
                <ul>
                  {[...cart].reverse().map((row) => (
                    <li
                      key={row.skuId}
                      className="flex items-center gap-2.5 border-b border-[#e4e4e7] py-[17px] last:border-b-0"
                    >
                      <SkuThumbnail
                        fileIds={row.imageFileIds}
                        className={THUMB}
                      />
                      <span className="min-w-0 flex-1">
                        <strong className="block truncate text-[13px] leading-[1.6] font-semibold text-[#27272a]">
                          {row.skuName}
                        </strong>
                        <small className="mt-[3px] block truncate text-[11px] text-[#71717a]">
                          {row.optionKey ? `${row.optionKey} · ` : ''}
                          <span className="font-mono">{row.skuCode}</span>
                        </small>
                        <WaitingOrdersNote waiting={waiting.of(row.skuId)} />
                      </span>
                      <button
                        type="button"
                        aria-label={`${row.skuName} 수량`}
                        className="min-w-[47px] rounded-md border border-[#e4e4e7] px-2.5 py-2 text-base font-[650] text-[#27272a] tabular-nums hover:bg-[#eff6ff] disabled:opacity-40"
                        disabled={
                          !reconciled ||
                          !draft.ready ||
                          scanQueue.blocked() ||
                          submit.isPending ||
                          saving ||
                          !!editing
                        }
                        onClick={() => {
                          if (!reconciled) return;
                          setNotice(null);
                          setQuantityText(String(row.quantity));
                          setEditing(row.skuId);
                        }}
                      >
                        {row.quantity}
                      </button>
                      <button
                        type="button"
                        aria-label={`${row.skuName} 삭제`}
                        className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[7px] text-[#71717a] hover:bg-[#eff6ff] disabled:opacity-40"
                        disabled={
                          !reconciled ||
                          !draft.ready ||
                          scanQueue.blocked() ||
                          submit.isPending ||
                          saving
                        }
                        onClick={async () => {
                          if (!reconciled || savingRef.current) return;
                          savingRef.current = true;
                          setSaving(true);
                          try {
                            await setCart((prev) =>
                              prev.filter((r) => r.skuId !== row.skuId)
                            );
                            // 지운 줄을 고치던 중이었으면 수정도 닫는다 — 다른 줄의 수정은 그대로 둔다.
                            setEditing((cur) =>
                              cur === row.skuId ? null : cur
                            );
                          } catch {
                            setNotice(
                              '삭제를 저장하지 못했어요. 다시 시도해 주세요.'
                            );
                          } finally {
                            savingRef.current = false;
                            setSaving(false);
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {station ? (
              <div className="border-t border-[#e4e4e7] bg-[#fafafa] p-5">
                <div className="mb-[18px] flex items-center justify-between text-[13px] text-[#27272a]">
                  <span>{cart.length}종 입고 예정</span>
                  <strong className="text-[28px] tracking-[-1px] tabular-nums">
                    {cartTotal}
                    <span className="ml-[5px] text-sm font-normal">개</span>
                  </strong>
                </div>
                <div className="space-y-2">
                  {registerError}
                  {registerButton}
                </div>
                <p className="mt-2.5 text-center text-[11px] text-[#71717a]">
                  담은 상품과 등록 버튼은 항상 이 자리에 있어요.
                </p>
              </div>
            ) : null}
          </aside>

          {station ? null : (
            <div className="sticky bottom-0 space-y-2 rounded-xl border border-[#e4e4e7] bg-[#fafafa] p-4 shadow-[0_-4px_16px_#0000000a]">
              {registerError}
              <div className="flex items-center gap-3">
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-semibold text-[#27272a]">
                    담은 상품 {cart.length}종 · {cartTotal}개
                  </span>
                  <button
                    type="button"
                    className="text-xs text-[#2563eb] underline"
                    onClick={() =>
                      cartRef.current?.scrollIntoView?.({ block: 'start' })
                    }
                  >
                    목록 보기
                  </button>
                </span>
                {registerButton}
              </div>
            </div>
          )}
        </section>
      )}

      {editingRow && !scanQueue.blocked() && !submit.isPending ? (
        <QuickQuantitySheet
          skuName={editingRow.skuName}
          skuCode={editingRow.skuCode}
          waiting={waiting.of(editingRow.skuId)}
          value={quantityText}
          onChange={setQuantityText}
          saving={saving}
          notice={notice}
          onSave={() => void saveQuantity()}
          onCancel={() => setEditing(null)}
          onScanBlocked={() => setNotice('수량 창을 닫은 뒤 다시 찍어 주세요.')}
        />
      ) : null}

      {cancelFor && warehouseId ? (
        <CancelReceiptDialog
          target={cancelFor}
          warehouseId={warehouseId}
          onClose={() => setCancelFor(null)}
          onFinished={(outcome) => {
            setCancelFor(null);
            if (outcome.ok)
              toast.show({ kind: 'cancelled', detail: outcome.detail });
            else setNotice(outcome.notice);
            void reconcileRef.current?.().catch(() => {});
          }}
        />
      ) : null}

      {putawayFor ? (
        <PutawaySheet
          target={putawayFor}
          warehouseId={warehouseId}
          lastDest={lastDest}
          onCancel={() => setPutawayFor(null)}
          onDone={async (dest, _quantity, usualShelfSet) => {
            setLastDest(dest);
            setPutawayFor(null);
            if (usualShelfSet) setNotice(usualShelfNotice(dest.code));
            await reconcileRef.current?.().catch(() => {});
          }}
        />
      ) : null}
    </div>
  );
}

export function QuickInboundScreen({ station = false }: { station?: boolean }) {
  return (
    <WorkArea kind="inbound">
      <QuickInboundScreenContent station={station} />
    </WorkArea>
  );
}
