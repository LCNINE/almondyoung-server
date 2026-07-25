import { useEffect, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useWarehouse } from '../../app/warehouse-context';
import { errorMessage } from '../../core/data/errorMessage';
import { Button } from '../../core/design/Button';
import { NumberPad } from '../../core/design/NumberPad';
import { ScreenHeader } from '../../core/design/ScreenHeader';
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

export function QuickInboundScreen() {
  const { warehouseId, isSet } = useWarehouse();
  const lookup = useSkuByBarcode();
  const submit = useSimpleInbound();

  const [cart, setCart] = useState<CartRow[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [staged, setStaged] = useState<FreshLine[]>([]);
  const [putawayFor, setPutawayFor] = useState<FreshLine | null>(null);
  const [lastDest, setLastDest] = useState<LocationRef | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  // 멱등키 회전 — 카트 내용이 바뀌면 새 키.
  const cartSignature = cart.map((r) => `${r.skuId}:${r.quantity}`).join('|');
  const prevSignatureRef = useRef(cartSignature);
  useEffect(() => {
    if (prevSignatureRef.current === cartSignature) return;
    prevSignatureRef.current = cartSignature;
    setIdempotencyKey(crypto.randomUUID());
  }, [cartSignature]);

  // 적치 대기 목록으로 넘어간 뒤에는 스캔이 카트를 건드리면 안 된다.
  const stagedMode = staged.length > 0;

  useScanner((e) => {
    if (stagedMode || putawayFor) return;
    lookup.mutate(e.code, {
      onSuccess: (skus) => {
        const sku = skus[0];
        if (!sku) {
          setNotice('등록되지 않은 바코드예요.');
          return;
        }
        const step = scanIncrement(sku, e.code);
        setNotice(null);
        setCart((prev) => {
          const found = prev.find((r) => r.skuId === sku.id);
          if (!found) {
            return [...prev, { skuId: sku.id, skuCode: sku.code, skuName: sku.name, quantity: step }];
          }
          return prev.map((r) => (r.skuId === sku.id ? { ...r, quantity: r.quantity + step } : r));
        });
      },
      onError: (err) => setNotice(errorMessage(err, 'barcode')),
    });
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

      {notice ? (
        <p role="alert" className="rounded-md bg-amber-50 p-2 text-sm text-amber-800">
          {notice}
        </p>
      ) : null}

      {stagedMode ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-gray-700">적치 대기</h2>
          <p className="text-xs text-gray-500">
            입고는 끝났어요. 각 품목을 선반에 꽂으면서 대상 로케이션을 찍어 주세요.
          </p>
          <ul className="space-y-2">
            {staged.map((line) => (
              <li
                key={line.lineId}
                className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-3"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-gray-800">{line.skuName}</span>
                  <span className="block font-mono text-xs text-gray-500">{line.skuCode}</span>
                </span>
                <span className="text-lg font-semibold text-gray-900">{line.quantity}</span>
                {line.putawayDone ? (
                  <span className="shrink-0 text-xs font-semibold text-green-700">완료</span>
                ) : (
                  <Button className="shrink-0 px-3 py-1.5 text-xs" onClick={() => setPutawayFor(line)}>
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
            <p className="text-sm text-gray-500">상품 바코드를 스캔해 주세요.</p>
          ) : (
            <ul className="space-y-2">
              {cart.map((row) => (
                <li key={row.skuId} className="space-y-2 rounded-lg border border-gray-200 bg-white p-3">
                  <div className="flex items-center gap-3">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-gray-800">{row.skuName}</span>
                      <span className="block font-mono text-xs text-gray-500">{row.skuCode}</span>
                    </span>
                    <button
                      type="button"
                      aria-label={`${row.skuName} 수량`}
                      className="text-lg font-semibold text-gray-900 underline"
                      onClick={() => setEditing(editing === row.skuId ? null : row.skuId)}
                    >
                      {row.quantity}
                    </button>
                    <button
                      type="button"
                      aria-label={`${row.skuName} 삭제`}
                      className="shrink-0 rounded p-1 text-gray-400 active:bg-gray-100"
                      onClick={() => setCart((prev) => prev.filter((r) => r.skuId !== row.skuId))}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                  {editing === row.skuId ? (
                    <NumberPad
                      value={row.quantity}
                      onChange={(next) =>
                        setCart((prev) =>
                          prev.map((r) => (r.skuId === row.skuId ? { ...r, quantity: next } : r))
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
            disabled={cart.length === 0 || cart.some((r) => r.quantity < 1) || submit.isPending}
            onClick={() => {
              if (!warehouseId) return;
              submit.mutate(
                {
                  warehouseId,
                  items: cart.map((r) => ({ skuId: r.skuId, quantity: r.quantity })),
                  idempotencyKey,
                },
                {
                  onSuccess: (result) => {
                    // 응답 lines[] 를 카트 행과 skuId 로 맞춰 이름을 되살린다.
                    setStaged(
                      result.lines.map((line) => {
                        const row = cart.find((r) => r.skuId === line.skuId);
                        return {
                          lineId: line.id,
                          skuId: line.skuId,
                          skuCode: row?.skuCode ?? '',
                          skuName: row?.skuName ?? '',
                          quantity: line.quantity,
                          putawayDone: false,
                        };
                      })
                    );
                    setIdempotencyKey(crypto.randomUUID());
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
          line={putawayFor}
          warehouseId={warehouseId}
          lastDest={lastDest}
          onCancel={() => setPutawayFor(null)}
          onDone={(dest) => {
            setLastDest(dest);
            setStaged((prev) =>
              prev.map((l) => (l.lineId === putawayFor.lineId ? { ...l, putawayDone: true } : l))
            );
            setPutawayFor(null);
          }}
        />
      ) : null}
    </div>
  );
}
