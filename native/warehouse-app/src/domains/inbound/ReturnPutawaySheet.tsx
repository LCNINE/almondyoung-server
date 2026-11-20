import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { WorkArea } from '../../core/operations/WorkBoundary';
import { ApiError } from '../../core/data/httpClient';
import { errorMessage } from '../../core/data/errorMessage';
import { Button } from '../../core/design/Button';
import { QuantityInput, parseQuantity } from '../../core/design/QuantityInput';
import { NumberPad } from '../../core/design/NumberPad';
import { useScanner } from '../../core/hardware/scan/useScanner';
import { preventScanEnterActivation } from '../../core/hardware/scan/hidScanBoundary';
import { useLocationSearch } from '../warehouse/useLocationSearch';
import { useMoveStock } from '../movement/useMoveStock';
import { RETURN_GOODS_KEY, type ReturnGoodsItem } from './returnGoods';
import type { LocationRef } from './PutawaySheet';

export interface ReturnPutawayTarget extends ReturnGoodsItem {
  returnLocationId: string;
  returnLocationCode: string;
}

function usualShelf(target: ReturnPutawayTarget): LocationRef | null {
  return target.usualLocationId && target.usualLocationCode
    ? {
        id: target.usualLocationId,
        code: target.usualLocationCode,
        isActive: true,
        isSystem: false,
      }
    : null;
}

/**
 * 반품 양품을 반품 자리에서 선반으로 옮긴다 — 입고 적치와 같은 손동작이지만 기록은 일반 이동이다.
 * 평소 선반이 있으면 대상지로 미리 넣어 두고, 다른 곳을 찍으면 바꿀 수 있다.
 */
function ReturnPutawaySheetContent({
  target,
  warehouseId,
  onDone,
  onCancel,
}: {
  target: ReturnPutawayTarget;
  warehouseId: string;
  onDone: (dest: LocationRef, quantity: number) => void;
  onCancel: () => void;
}) {
  const [dest, setDest] = useState<LocationRef | null>(() =>
    usualShelf(target)
  );
  const [quantityText, setQuantityText] = useState(String(target.quantity));
  const quantity = parseQuantity(quantityText, 1) ?? 0;
  const [term, setTerm] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState(() =>
    crypto.randomUUID()
  );
  const [notice, setNotice] = useState<string | null>(null);
  // 보낸 이동은 결과가 정해질 때까지 대상지·수량을 바꿀 수 없다 — 응답을 못 받으면 실행기가 같은 키로 맞출 때까지 기다린다.
  const [sending, setSending] = useState<{
    dest: LocationRef;
    quantity: number;
  } | null>(null);
  const submitLock = useRef(false);
  const search = useLocationSearch(
    warehouseId,
    dest ? '' : term,
    'putaway-destination'
  );
  const move = useMoveStock();
  const qc = useQueryClient();

  const candidates = (search.data?.items ?? []).filter(
    (i) =>
      i.id !== target.returnLocationId && i.isActive === true && !i.isSystem
  );
  const choose = useCallback((loc: LocationRef) => {
    setDest(loc);
    setTerm('');
    setNotice(null);
  }, []);

  useScanner((e) => {
    if (sending) return;
    if (dest) setDest(null);
    setTerm(e.code);
  });

  useEffect(() => {
    if (dest) return;
    const trimmed = term.trim();
    if (!trimmed) return;
    const exact = (search.data?.items ?? []).filter(
      (i) =>
        i.code === trimmed &&
        i.id !== target.returnLocationId &&
        i.isActive === true &&
        !i.isSystem
    );
    if (exact.length === 1)
      choose({
        id: exact[0].id,
        code: exact[0].code,
        isActive: exact[0].isActive,
        isSystem: exact[0].isSystem,
      });
  }, [search.data, term, dest, target.returnLocationId, choose]);

  // 대상지나 수량을 바꾸면 새 키 — 응답만 잃은 앞 요청이 같은 키로 옛 값을 되돌려주지 않게.
  const keyPayload = useRef({ to: dest?.id ?? '', qty: quantity });
  useEffect(() => {
    const prev = keyPayload.current;
    if (prev.to === (dest?.id ?? '') && prev.qty === quantity) return;
    keyPayload.current = { to: dest?.id ?? '', qty: quantity };
    setIdempotencyKey(crypto.randomUUID());
  }, [dest, quantity]);

  async function submit() {
    if (submitLock.current) return;
    const sent =
      dest && quantity >= 1 && quantity <= target.quantity
        ? { dest, quantity, key: idempotencyKey }
        : null;
    if (!sent) return;
    submitLock.current = true;
    setSending(sent);
    setNotice(null);
    try {
      await move.mutateAsync({
        warehouseId,
        skuId: target.skuId,
        fromLocationId: target.returnLocationId,
        toLocationId: sent.dest.id,
        quantity: sent.quantity,
        reason: '반품 적치',
        idempotencyKey: sent.key,
      });
      void qc.invalidateQueries({ queryKey: [RETURN_GOODS_KEY] });
      onDone(sent.dest, sent.quantity);
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.outcome === 'rejected' &&
        error.code === 'MOVEMENT_DESTINATION_INACTIVE'
      ) {
        setDest(null);
        setNotice('사용하지 않는 로케이션이에요. 다른 선반을 찍어 주세요.');
      } else {
        setNotice(errorMessage(error, 'movement'));
      }
      void qc.invalidateQueries({ queryKey: [RETURN_GOODS_KEY] });
    } finally {
      submitLock.current = false;
      setSending(null);
    }
  }

  const usual = usualShelf(target);
  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="반품 양품 적치"
      onKeyDown={(event) => preventScanEnterActivation(event.nativeEvent)}
    >
      <div className="max-h-[90vh] w-full max-w-sm space-y-4 overflow-y-auto rounded-xl bg-white p-5 shadow-lg">
        <div>
          <div className="font-semibold text-gray-800">{target.skuName}</div>
          <div className="font-mono text-xs text-gray-500">
            {target.skuCode}
          </div>
          <div className="mt-1 text-xs text-gray-500">
            {target.returnLocationCode} · 반품 양품 {target.quantity}개
          </div>
        </div>

        {sending ? (
          <p
            role="status"
            className="rounded-lg border border-blue-300 bg-blue-50 p-3 text-sm text-blue-800"
          >
            {sending.dest.code}에 {sending.quantity}개 옮기는 중이에요
          </p>
        ) : (
          <>
            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-gray-700">적치 수량</h3>
              <div className="flex items-center gap-2">
                <output className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-right text-xl font-semibold">
                  {quantity}
                </output>
                <button
                  type="button"
                  className="rounded-md border border-blue-300 bg-blue-50 px-3 py-2 text-sm text-blue-700"
                  onClick={() => setQuantityText(String(target.quantity))}
                >
                  전량
                </button>
              </div>
              <QuantityInput
                label="적치 수량 직접 입력"
                value={quantityText}
                onChange={setQuantityText}
                min={1}
                max={target.quantity}
              />
              <NumberPad
                value={quantity}
                onChange={(next) => setQuantityText(String(next))}
              />
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-gray-700">
                대상 로케이션
              </h3>
              {dest ? (
                <div className="flex items-center gap-3 rounded-lg border border-blue-500 bg-blue-50 p-3">
                  <span className="flex-1 font-medium text-gray-800">
                    {dest.code}
                    {usual && dest.id === usual.id ? (
                      <span className="ml-2 text-xs text-blue-700">
                        평소 선반
                      </span>
                    ) : null}
                  </span>
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
                  {usual ? (
                    <button
                      type="button"
                      className="w-full rounded-md border border-blue-300 bg-blue-50 p-2 text-sm text-blue-700"
                      onClick={() => choose(usual)}
                    >
                      평소 선반 {usual.code} 사용
                    </button>
                  ) : (
                    <p className="text-xs text-gray-500">
                      평소 선반이 정해지지 않은 상품이에요. 넣을 선반을 찍어
                      주세요.
                    </p>
                  )}
                  <input
                    aria-label="대상 로케이션 검색"
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    placeholder="대상 로케이션 바코드를 스캔하거나 코드를 입력하세요"
                    value={term}
                    onChange={(e) => setTerm(e.target.value)}
                  />
                  {search.isError ? (
                    <p role="alert" className="text-sm text-red-600">
                      {errorMessage(search.error, 'location')}
                    </p>
                  ) : (
                    <ul className="space-y-1">
                      {candidates.map((loc) => (
                        <li key={loc.id}>
                          <button
                            type="button"
                            className="w-full rounded-md border border-gray-200 bg-white p-3 text-left active:bg-gray-50"
                            onClick={() =>
                              choose({
                                id: loc.id,
                                code: loc.code,
                                isActive: loc.isActive,
                                isSystem: loc.isSystem,
                              })
                            }
                          >
                            {loc.code}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </section>
          </>
        )}

        {notice ? (
          <p role="alert" className="text-sm text-red-600">
            {notice}
          </p>
        ) : null}

        <div className="flex gap-2">
          <Button
            type="button"
            className="flex-1 border border-gray-300 bg-white text-gray-800 hover:bg-gray-50"
            onClick={onCancel}
          >
            나중에
          </Button>
          <Button
            type="button"
            className="flex-1"
            disabled={
              !!sending || !dest || quantity < 1 || quantity > target.quantity
            }
            onClick={() => void submit()}
          >
            적치
          </Button>
        </div>
      </div>
    </div>
  );
}

export function ReturnPutawaySheet(
  props: Parameters<typeof ReturnPutawaySheetContent>[0]
) {
  return (
    <WorkArea kind="movement">
      <ReturnPutawaySheetContent {...props} />
    </WorkArea>
  );
}
