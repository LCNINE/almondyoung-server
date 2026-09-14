import {
  confirmedPutawayQuantity,
  withConfirmedPutaway,
} from './confirmedPutaway';
import { useWorkRuntime } from '../../core/operations/OperationContext';
import type { SimpleInboundResult } from './types';
import { WorkArea } from '../../core/operations/WorkBoundary';
import { useEffect, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useWorkDraft } from '../../core/operations/useWorkDraft';
import { useWarehouse } from '../../app/warehouse-context';
import { errorMessage } from '../../core/data/errorMessage';
import { Button } from '../../core/design/Button';
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
  const submit = useSimpleInbound();

  const initialDraft = useRef({
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
  useEffect(() => {
    if (!runtime || !draft.ready) return;
    let live = true;
    const reconcile = async () => {
      const current = await draft.read();
      const op = await runtime.store.get(current.key);
      if (op?.status === 'confirmed' && current.staged.length === 0) {
        const result = op.result as SimpleInboundResult;
        await draft.update((prev) => ({
          ...prev,
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
      await draft.update((prev) => ({
        ...prev,
        staged: prev.staged.map((line) =>
          withConfirmedPutaway(line, quantities.get(line.lineId) ?? 0)
        ),
      }));
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
  }, [runtime, draft.ready, idempotencyKey]);
  const [editing, setEditing] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [putawayFor, setPutawayFor] = useState<FreshLine | null>(null);
  const [lastDest, setLastDest] = useState<LocationRef | null>(null);
  // 적치 대기 목록으로 넘어간 뒤에는 스캔이 카트를 건드리면 안 된다.
  const stagedMode = staged.length > 0;

  const scanQueue = useWorkScanQueue<string>(async (code, eventId) => {
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
    if (stagedMode || submit.isPending || !draft.ready) {
      setNotice('현재 작업을 마친 뒤 다시 찍어 주세요.');
      return;
    }
    scanQueue.enqueue(e.code);
  });

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
                {line.putawayDoneQty >= line.quantity ? (
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
            onClick={() => {
              setStaged([]);
              setCart([]);
            }}
          >
            새 입고 시작
          </Button>
        </section>
      ) : (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-gray-700">스캔한 품목</h2>
          {cart.length === 0 ? (
            <p className="text-sm text-gray-500">
              상품 바코드를 스캔해 주세요.
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
                      disabled={scanQueue.blocked() || submit.isPending}
                      onClick={() =>
                        setEditing(editing === row.skuId ? null : row.skuId)
                      }
                    >
                      {row.quantity}
                    </button>
                    <button
                      type="button"
                      aria-label={`${row.skuName} 삭제`}
                      className="shrink-0 rounded p-1 text-gray-400 active:bg-gray-100"
                      disabled={scanQueue.blocked() || submit.isPending}
                      onClick={() =>
                        void setCart((prev) =>
                          prev.filter((r) => r.skuId !== row.skuId)
                        )
                      }
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                  {editing === row.skuId &&
                  !scanQueue.blocked() &&
                  !submit.isPending ? (
                    <NumberPad
                      value={row.quantity}
                      onChange={(next) =>
                        setCart((prev) =>
                          prev.map((r) =>
                            r.skuId === row.skuId ? { ...r, quantity: next } : r
                          )
                        )
                      }
                    />
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
                    await setStaged(
                      result.lines.map((line) => {
                        const row = cart.find((r) => r.skuId === line.skuId);
                        return {
                          lineId: line.id,
                          skuId: line.skuId,
                          skuCode: row?.skuCode ?? '',
                          skuName: row?.skuName ?? '',
                          quantity: line.quantity,
                          putawayDoneQty: 0,
                        };
                      })
                    );
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
