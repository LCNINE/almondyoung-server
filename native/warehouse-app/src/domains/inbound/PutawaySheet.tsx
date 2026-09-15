import { receiptFeedback } from './receiptFeedback';
import { useReceiptReconciliation } from './useReceiptReconciliation';
import { WorkArea } from '../../core/operations/WorkBoundary';
import { useEffect, useRef, useState } from 'react';
import { errorMessage } from '../../core/data/errorMessage';
import { Button } from '../../core/design/Button';
import { QuantityInput, parseQuantity } from '../../core/design/QuantityInput';
import { NumberPad } from '../../core/design/NumberPad';
import { useScanner } from '../../core/hardware/scan/useScanner';
import { useLocationSearch } from '../warehouse/useLocationSearch';
import { usePutaway } from './mutations';
import type { PutawayTarget } from './types';

export interface LocationRef {
  id: string;
  code: string;
}

/**
 * 입고 직후 적치 — 재고 이동 화면의 대상지 선택을 입고 문맥으로 옮긴 것이다.
 * 시트가 열려 있는 동안 스캔은 전부 로케이션 코드로 해석된다(상품 바코드는
 * 이 시점에 의미가 없다).
 */
function PutawaySheetContent({
  target,
  warehouseId,
  lastDest,
  onDone,
  onCancel,
}: {
  target: PutawayTarget;
  warehouseId: string | null;
  lastDest: LocationRef | null;
  onDone: (dest: LocationRef, quantity: number) => void;
  onCancel: () => void;
}) {
  const [dest, setDest] = useState<LocationRef | null>(null);
  const [quantityText, setQuantityText] = useState(String(target.pendingQty));
  const quantity = parseQuantity(quantityText, 1) ?? 0;
  const setQuantity = (next: number) => setQuantityText(String(next));
  const [term, setTerm] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState(() =>
    crypto.randomUUID()
  );
  const search = useLocationSearch(warehouseId, dest ? '' : term);
  const putaway = usePutaway();
  const receipt = useReceiptReconciliation({
    lineId: target.lineId,
    warehouseId,
    expectedSource: target.source,
  });
  const [reviewedPending, setReviewedPending] = useState(target.pendingQty);
  const [notice, setNotice] = useState<string | null>(null);
  const submitLock = useRef(false);
  const [checking, setChecking] = useState(false);
  const pendingQty = receipt.state?.pendingQty ?? reviewedPending;
  const activeIdentity = useRef('');
  activeIdentity.current = `${warehouseId}:${target.lineId}`;
  async function submitPutaway() {
    if (!dest || submitLock.current) return;
    submitLock.current = true;
    setChecking(true);
    setNotice(null);
    const identity = activeIdentity.current;
    try {
      const latest = await receipt.refresh();
      if (identity !== activeIdentity.current) return;
      if (
        !latest.canPutaway ||
        latest.originLocationId !== target.originLocationId ||
        dest.id === latest.originLocationId
      ) {
        setNotice(
          '지금은 적치할 수 없어요. 입고내역과 원위치를 확인해 주세요.'
        );
        return;
      }
      if (latest.pendingQty !== reviewedPending) {
        setReviewedPending(latest.pendingQty);
        setNotice(
          `잔량이 바뀌었어요. 현재 ${latest.pendingQty}개예요. 입력한 수량을 확인한 뒤 다시 적치해 주세요.`
        );
        return;
      }
      if (quantity < 1 || quantity > latest.pendingQty) return;
      await putaway.mutateAsync({
        lineId: target.lineId,
        toLocationId: dest.id,
        quantity,
        idempotencyKey,
      });
      if (identity === activeIdentity.current) onDone(dest, quantity);
    } catch (error) {
      if (identity === activeIdentity.current)
        setNotice(receiptFeedback(error, 'putaway'));
    } finally {
      submitLock.current = false;
      setChecking(false);
    }
  }

  // 검색 결과에서 출발지를 뺀 후보 목록 — 렌더와 자동선택 이펙트가 같은
  // 필터를 공유한다. rawResults 가 있는데(검색은 됐는데) candidateLocations 가
  // 비면 "찾은 로케이션이 전부 출발지였다"는 뜻이다 — "못 찾음"과는 다른
  // 사실이라 화면이 구분해 말해야 한다(작업자가 출발지 라벨을 대상지로 스캔한
  // 경우가 실제로 생긴다).
  const rawLocationResults = search.data?.items ?? [];
  const candidateLocations = rawLocationResults.filter(
    (i) => i.id !== target.originLocationId
  );
  const onlyOriginMatched =
    rawLocationResults.length > 0 && candidateLocations.length === 0;

  useScanner((e) => {
    if (!dest) setTerm(e.code);
  });

  // 코드 완전일치 단건이면 자동 선택 — 이동 화면과 같은 규칙. 출발지는 후보에서
  // 제외한다 — 방금 나온 곳으로 다시 넣는 건 적치가 아니다.
  //
  // candidateLocations(파생 배열)를 의존성에 넣지 않는다 — filter() 는 매 렌더
  // 새 배열을 만들어 참조가 매번 바뀌므로, 그걸 deps 에 넣으면 이 effect 가
  // term·dest 와 무관하게 렌더마다 재실행된다. search.data 는 react-query 가
  // 응답이 안 바뀌는 한 참조를 유지하므로 원본 값을 deps 로 쓴다.
  useEffect(() => {
    if (dest) return;
    const trimmed = term.trim();
    if (!trimmed) return;
    const exact = (search.data?.items ?? []).filter(
      (i) => i.code === trimmed && i.id !== target.originLocationId
    );
    if (exact.length === 1) {
      setDest({ id: exact[0].id, code: exact[0].code });
      setTerm('');
    }
  }, [search.data, term, dest, target.originLocationId]);

  // target 이 바뀌면(부모가 언마운트 없이 다음 라인으로 넘기는 경우) 이전 라인에서
  // 고른 대상지가 그대로 남아있으면 안 된다 — 새 라인을 작업자가 아직 아무것도
  // 결정하지 않았는데 적치 버튼이 활성화되는 사고로 이어진다.
  useEffect(() => {
    setDest(null);
    setTerm('');
    setQuantity(target.pendingQty);
    setReviewedPending(target.pendingQty);
    setNotice(null);
    // A new target resets input; a refreshed quantity for the same target never does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.lineId, warehouseId]);

  // 멱등키 회전: 대상지나 수량이 바뀌면 새 키. "커밋됐는데 응답만 유실" 뒤 값을
  // 고쳐 재제출할 때 옛 payload 를 같은 키로 replay 하면 서버가 옛 결과를 돌려주고
  // 화면은 새 값이 반영된 줄 안다 — 원장과 화면이 갈린다.
  const keyPayloadRef = useRef({
    lineId: target.lineId,
    to: '',
    qty: target.pendingQty,
  });
  useEffect(() => {
    const next = { lineId: target.lineId, to: dest?.id ?? '', qty: quantity };
    const prev = keyPayloadRef.current;
    if (
      prev.lineId === next.lineId &&
      prev.to === next.to &&
      prev.qty === next.qty
    )
      return;
    keyPayloadRef.current = next;
    setIdempotencyKey(crypto.randomUUID());
  }, [target.lineId, dest, quantity]);

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="적치"
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.preventDefault();
      }}
    >
      <div className="max-h-[90vh] w-full max-w-sm space-y-4 overflow-y-auto rounded-xl bg-white p-5 shadow-lg">
        <div>
          <div className="font-semibold text-gray-800">{target.skuName}</div>
          <div className="font-mono text-xs text-gray-500">
            {target.skuCode}
          </div>
          <div className="mt-1 text-xs text-gray-500">
            {target.originLocationCode} · 잔여 {pendingQty}개
          </div>
        </div>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-gray-700">적치 수량</h3>
          <div className="flex items-center gap-2">
            <output className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-right text-xl font-semibold">
              {quantity}
            </output>
            <button
              type="button"
              className="rounded-md border border-blue-300 bg-blue-50 px-3 py-2 text-sm text-blue-700"
              onClick={() => setQuantity(pendingQty)}
            >
              전량
            </button>
          </div>
          <QuantityInput
            label="적치 수량 직접 입력"
            value={quantityText}
            onChange={setQuantityText}
            min={1}
            max={pendingQty}
          />
          <NumberPad value={quantity} onChange={setQuantity} />
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-gray-700">대상 로케이션</h3>
          {dest ? (
            <div className="flex items-center gap-3 rounded-lg border border-blue-500 bg-blue-50 p-3">
              <span className="flex-1 font-medium text-gray-800">
                {dest.code}
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
              {lastDest && lastDest.id !== target.originLocationId ? (
                <button
                  type="button"
                  className="w-full rounded-md border border-blue-300 bg-blue-50 p-2 text-sm text-blue-700"
                  onClick={() => setDest(lastDest)}
                >
                  직전 대상지 {lastDest.code} 사용
                </button>
              ) : null}
              <label htmlFor="putaway-dest" className="sr-only">
                대상 로케이션 검색
              </label>
              <input
                id="putaway-dest"
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
              ) : onlyOriginMatched ? (
                // 검색은 됐다(rawLocationResults 있음) — 다만 그게 전부 출발지였다.
                // "코드를 못 찾음"과 구분해서 말해야 작업자가 다른 로케이션을 찾는다.
                <p role="status" className="text-sm text-amber-700">
                  여기가 출발지예요. 다른 로케이션을 고르세요.
                </p>
              ) : (
                <ul className="space-y-1">
                  {candidateLocations.map((loc) => (
                    <li key={loc.id}>
                      <button
                        type="button"
                        className="w-full rounded-md border border-gray-200 bg-white p-3 text-left active:bg-gray-50"
                        onClick={() => setDest({ id: loc.id, code: loc.code })}
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

        {notice && <p role="alert">{notice}</p>}
        {!receipt.ready && (
          <div>
            <p role="status">입고 상태를 다시 확인해 주세요.</p>
            <Button onClick={() => void receipt.refresh().catch(() => {})}>
              다시 확인
            </Button>
          </div>
        )}
        {receipt.error && (
          <p role="alert">{receiptFeedback(receipt.error, 'putaway')}</p>
        )}
        {receipt.ready && !receipt.state?.canPutaway && (
          <p role="alert">
            지금은 적치할 수 없어요. 입고내역과 원위치를 확인해 주세요.
          </p>
        )}
        {putaway.isError ? (
          <p role="alert" className="text-sm text-red-600">
            {errorMessage(putaway.error, 'putaway')}
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
              !dest ||
              !receipt.ready ||
              !receipt.state?.canPutaway ||
              checking ||
              putaway.isPending ||
              quantity < 1 ||
              quantity > pendingQty
            }
            onClick={() => void submitPutaway()}
          >
            적치
          </Button>
        </div>
      </div>
    </div>
  );
}

export function PutawaySheet(props: Parameters<typeof PutawaySheetContent>[0]) {
  return (
    <WorkArea kind="inbound">
      <PutawaySheetContent {...props} />
    </WorkArea>
  );
}
