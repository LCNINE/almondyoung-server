import {
  confirmedPutawayQuantity,
  confirmedCanceledQuantity,
  withConfirmedPutaway,
} from './confirmedPutaway';
import { Link } from '@tanstack/react-router';
import { useApiClient } from '../../core/data/ApiClientProvider';
import { receiptHistoryPath, validateReceiptHistory } from './receiptHistory';
import { useWorkRuntime } from '../../core/operations/OperationContext';
import type { SimpleInboundResult } from './types';
import { WorkArea } from '../../core/operations/WorkBoundary';
import { useEffect, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useWorkDraft } from '../../core/operations/useWorkDraft';
import { useWarehouse } from '../../app/warehouse-context';
import { errorMessage } from '../../core/data/errorMessage';
import { Button } from '../../core/design/Button';
import { QuantityInput, parseQuantity } from '../../core/design/QuantityInput';
import { SkuPicker, type SelectedSku } from '../inventory/SkuPicker';
import { BarcodeInput } from '../../core/hardware/scan/BarcodeInput';
import { useUnsavedWork } from '../../core/operations/useUnsavedWork';
import { NumberPad } from '../../core/design/NumberPad';
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
import { PutawaySheet, type LocationRef } from './PutawaySheet';
import type { FreshLine } from './types';

interface CartRow {
  skuId: string;
  skuCode: string;
  skuName: string;
  quantity: number;
}

function QuickInboundScreenContent() {
  const { warehouseId, isSet } = useWarehouse();
  const lookup = useSkuByBarcode();
  const api = useApiClient();
  const submit = useSimpleInbound();

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
  const setStaged = (
    reduce: FreshLine[] | ((prev: FreshLine[]) => FreshLine[])
  ) =>
    draft.update((prev) => ({
      ...prev,
      staged: typeof reduce === 'function' ? reduce(prev.staged) : reduce,
    }));
  const runtime = useWorkRuntime();
  const [reconciled, setReconciled] = useState(!runtime);
  const reconcileRef = useRef<(() => Promise<void>) | null>(null);
  const reconciliation = useRef<Promise<void> | null>(null);
  useEffect(() => {
    if (!runtime || !draft.ready) return;
    let live = true;
    let generation = 0;
    const reconcile = async () => {
      const thisGeneration = ++generation;
      if (live) setReconciled(false);
      const current = await draft.read();
      const op = await runtime.store.get(current.key);
      if (op && op.status !== 'confirmed' && op.status !== 'rejected')
        throw new Error('입고 처리 여부를 먼저 확인해 주세요.');
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
      const quantities = new Map(
        await Promise.all(
          latest.staged.map(
            async (line) =>
              [
                line.lineId,
                await confirmedPutawayQuantity(runtime, line.lineId),
              ] as const
          )
        )
      );
      const canceled = new Map(
        await Promise.all(
          latest.staged.map(
            async (line) =>
              [
                line.lineId,
                await confirmedCanceledQuantity(runtime, line.lineId),
              ] as const
          )
        )
      );
      if ([...canceled.values()].some((quantity) => quantity > 0))
        await draft.update((prev) => ({
          ...prev,
          staged: prev.staged.map((line) => ({
            ...line,
            canceledQty: Math.max(
              line.canceledQty ?? 0,
              canceled.get(line.lineId) ?? 0
            ),
          })),
        }));
      const receiptId =
        latest.receiptId ??
        (op?.status === 'confirmed'
          ? (op.result as SimpleInboundResult).id
          : undefined);
      let historyLines: import('./receiptHistory').ReceiptHistoryLine[] = [];
      if (latest.staged.length) {
        if (!receiptId || !warehouseId)
          throw new Error('입고내역에서 상태를 확인해 주세요.');
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
          throw new Error('입고내역을 확인해 주세요.');
        historyLines = receipt.lines;
      }
      if (!live || thisGeneration !== generation) return;
      await draft.update((prev) => ({
        ...prev,
        receiptId: receiptId ?? null,
        staged: prev.staged.map((line) => {
          const currentLine = historyLines.find(
            (item) => item.id === line.lineId
          );
          return {
            ...withConfirmedPutaway(
              line,
              Math.max(
                quantities.get(line.lineId) ?? 0,
                currentLine?.putawayFromOriginQty ?? 0
              )
            ),
            canceledQty: Math.max(
              currentLine?.canceledQty ?? 0,
              line.canceledQty ?? 0,
              canceled.get(line.lineId) ?? 0
            ),
            returnedQty: currentLine?.returnedQty ?? line.returnedQty,
          };
        }),
      }));
      if (live && thisGeneration === generation) setReconciled(true);
    };
    const runReconcile = () => {
      const pending = reconcile();
      reconciliation.current = pending;
      return pending;
    };
    reconcileRef.current = runReconcile;
    void runReconcile().catch(() => {});
    const off = runtime.runner.subscribe(
      () => void runReconcile().catch(() => {})
    );
    return () => {
      live = false;
      off();
    };
  }, [runtime, draft.ready, api, warehouseId]);
  const [editing, setEditing] = useState<string | null>(null);
  const [quantityText, setQuantityText] = useState('');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  useUnsavedWork(
    editing !== null ||
      saving ||
      (!reconciled && cart.length > 0 && staged.length === 0)
  );
  const [notice, setNotice] = useState<string | null>(null);

  const [putawayFor, setPutawayFor] = useState<FreshLine | null>(null);
  const [lastDest, setLastDest] = useState<LocationRef | null>(null);
  // 적치 대기 목록으로 넘어간 뒤에는 스캔이 카트를 건드리면 안 된다.
  const stagedMode = staged.length > 0;

  const scanQueue = useWorkScanQueue<string>(async (code, eventId) => {
    // Restored physical inputs must wait for the original receipt result too.
    if (runtime) {
      if (!reconciliation.current)
        throw new Error('입고 상태를 확인해 주세요.');
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
  useScanner((e) => {
    if (putawayFor) return;
    if (
      stagedMode ||
      submit.isPending ||
      !draft.ready ||
      !reconciled ||
      editing ||
      savingRef.current
    ) {
      setNotice('현재 작업을 마친 뒤 다시 찍어 주세요.');
      return;
    }
    scanQueue.enqueue(e.code);
  });

  async function chooseSku(sku: SelectedSku) {
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
            quantity: 1,
          },
        ]);
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

  if (!isSet) {
    return (
      <div className="space-y-4">
        <ScreenHeader title="간편입고" backTo="/inbound" />
        <div className="space-y-3 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4">
          <p className="text-sm text-gray-600">창고를 먼저 선택해 주세요.</p>
          <WarehousePicker />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ScreenHeader title="간편입고" backTo="/inbound" />

      {!draft.ready ? <p role="status">작업을 불러오고 있어요.</p> : null}
      {draft.ready && !reconciled && !stagedMode && (
        <p role="status">
          이전 입고 결과를 확인하고 있어요. 확인 후 계속 입력할 수 있어요.
          <Button onClick={() => void reconcileRef.current?.().catch(() => {})}>
            입고 상태 다시 확인
          </Button>
        </p>
      )}
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

      {stagedMode ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-gray-700">적치 대기</h2>
          <p className="text-xs text-gray-500">
            입고는 끝났어요. 각 품목을 선반에 꽂으면서 대상 로케이션을 찍어
            주세요.
          </p>
          <Link to="/inbound/history">입고내역 · 취소</Link>
          {!reconciled && (
            <p role="alert">
              입고 상태를 확인하고 있어요. 확인이 안 되면 입고내역 또는 적치
              대기 목록에서 이어서 작업해 주세요.
            </p>
          )}
          <ul className="space-y-2">
            {staged.map((line) => (
              <li
                key={line.lineId}
                className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-3"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-gray-800">
                    {line.skuName}
                  </span>
                  <span className="block font-mono text-xs text-gray-500">
                    {line.skuCode}
                  </span>
                  {/* 예정 입고 화면 배너와 같은 문구 — 부분 적치가 손대지 않은 라인과
                      시각적으로 구분되지 않는 문제를 막는다. */}
                  {line.putawayDoneQty > 0 &&
                  line.putawayDoneQty < line.quantity ? (
                    <span className="block text-xs text-gray-500">
                      잔여 {line.quantity - line.putawayDoneQty}개 ·{' '}
                      {line.putawayDoneQty}개 적치됨
                    </span>
                  ) : null}
                </span>
                <span className="text-lg font-semibold text-gray-900">
                  {line.quantity}
                </span>
                {(line.canceledQty ?? 0) > 0 ? (
                  <span>취소됨</span>
                ) : (line.returnedQty ?? 0) > 0 ? (
                  <span>회송됨</span>
                ) : line.putawayDoneQty >= line.quantity ? (
                  <span className="shrink-0 text-xs font-semibold text-green-700">
                    완료
                  </span>
                ) : (
                  <Button
                    className="shrink-0 px-3 py-1.5 text-xs"
                    disabled={!reconciled || !!draft.error}
                    onClick={() => setPutawayFor(line)}
                  >
                    적치
                  </Button>
                )}
              </li>
            ))}
          </ul>
          <Button
            type="button"
            className="w-full border border-gray-300 bg-white text-gray-800 hover:bg-gray-50"
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
        </section>
      ) : (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-gray-700">입고할 품목</h2>
          <p className="text-xs text-gray-500">
            발주 상품은 예정 입고에서 등록해 주세요. 수량은 낱개 기준이에요.
          </p>
          <SkuPicker
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
          {cart.length === 0 ? (
            <p className="text-sm text-gray-500">
              상품을 검색해서 선택하거나 바코드를 입력해 주세요.
            </p>
          ) : (
            <ul className="space-y-2">
              {cart.map((row) => (
                <li
                  key={row.skuId}
                  className="space-y-2 rounded-lg border border-gray-200 bg-white p-3"
                >
                  <div className="flex items-center gap-3">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-gray-800">
                        {row.skuName}
                      </span>
                      <span className="block font-mono text-xs text-gray-500">
                        {row.skuCode}
                      </span>
                    </span>
                    <button
                      type="button"
                      aria-label={`${row.skuName} 수량`}
                      className="text-lg font-semibold text-gray-900 underline"
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
                        setQuantityText(String(row.quantity));
                        setEditing(row.skuId);
                      }}
                    >
                      {row.quantity}
                    </button>
                    <button
                      type="button"
                      aria-label={`${row.skuName} 삭제`}
                      className="shrink-0 rounded p-1 text-gray-400 active:bg-gray-100"
                      disabled={
                        !reconciled ||
                        !draft.ready ||
                        scanQueue.blocked() ||
                        submit.isPending ||
                        saving ||
                        !!editing
                      }
                      onClick={async () => {
                        if (!reconciled || savingRef.current) return;
                        savingRef.current = true;
                        setSaving(true);
                        try {
                          await setCart((prev) =>
                            prev.filter((r) => r.skuId !== row.skuId)
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
                  </div>
                  {editing === row.skuId &&
                  !scanQueue.blocked() &&
                  !submit.isPending ? (
                    <div className="space-y-2">
                      <QuantityInput
                        label="입고 수량 직접 입력"
                        value={quantityText}
                        onChange={setQuantityText}
                        min={1}
                        disabled={saving}
                      />
                      <fieldset disabled={saving}>
                        <NumberPad
                          value={parseQuantity(quantityText, 0) ?? 0}
                          onChange={(next) => setQuantityText(String(next))}
                        />
                      </fieldset>
                      <Button
                        disabled={
                          !reconciled ||
                          saving ||
                          parseQuantity(quantityText, 1) === null
                        }
                        onClick={() => void saveQuantity()}
                      >
                        수량 저장
                      </Button>
                      <Button
                        disabled={saving}
                        onClick={() => setEditing(null)}
                      >
                        수정 취소
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {submit.isError ? (
            <p role="alert" className="text-sm text-red-600">
              {errorMessage(submit.error, 'inbound')}
            </p>
          ) : null}

          <Button
            type="button"
            className="w-full"
            disabled={
              !reconciled ||
              !!editing ||
              saving ||
              !draft.ready ||
              !!draft.error ||
              scanQueue.blocked() ||
              cart.length === 0 ||
              cart.some((r) => r.quantity < 1) ||
              submit.isPending
            }
            onClick={() => {
              if (!warehouseId) return;
              submit.mutate(
                {
                  warehouseId,
                  items: cart.map((r) => ({
                    skuId: r.skuId,
                    quantity: r.quantity,
                  })),
                  idempotencyKey,
                },
                {
                  onSuccess: async (result) => {
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
            }}
          >
            등록
          </Button>
        </section>
      )}

      {putawayFor ? (
        <PutawaySheet
          target={{
            lineId: putawayFor.lineId,
            skuName: putawayFor.skuName,
            skuCode: putawayFor.skuCode,
            pendingQty: putawayFor.quantity - putawayFor.putawayDoneQty,
            originLocationCode: '입고기본존',
          }}
          warehouseId={warehouseId}
          lastDest={lastDest}
          onCancel={() => setPutawayFor(null)}
          onDone={async (dest, quantity) => {
            setLastDest(dest);
            const confirmed = runtime
              ? await confirmedPutawayQuantity(runtime, putawayFor.lineId)
              : null;
            await setStaged((prev) =>
              prev.map((l) =>
                l.lineId === putawayFor.lineId
                  ? withConfirmedPutaway(
                      l,
                      confirmed ?? l.putawayDoneQty + quantity
                    )
                  : l
              )
            );
            setPutawayFor(null);
          }}
        />
      ) : null}
    </div>
  );
}

export function QuickInboundScreen() {
  return (
    <WorkArea kind="inbound">
      <QuickInboundScreenContent />
    </WorkArea>
  );
}
