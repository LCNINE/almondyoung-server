import { useEffect, useRef, useState } from 'react';
import { errorMessage } from '../../core/data/errorMessage';
import { Button } from '../../core/design/Button';
import { useScanner } from '../../core/hardware/scan/useScanner';
import { useLocationSearch } from '../warehouse/useLocationSearch';
import { usePutaway } from './mutations';
import type { FreshLine } from './types';

export interface LocationRef {
  id: string;
  code: string;
}

/**
 * 입고 직후 적치 — 재고 이동 화면의 대상지 선택을 입고 문맥으로 옮긴 것이다.
 * 시트가 열려 있는 동안 스캔은 전부 로케이션 코드로 해석된다(상품 바코드는
 * 이 시점에 의미가 없다).
 */
export function PutawaySheet({
  line,
  warehouseId,
  lastDest,
  onDone,
  onCancel,
}: {
  line: FreshLine;
  warehouseId: string | null;
  lastDest: LocationRef | null;
  onDone: (dest: LocationRef) => void;
  onCancel: () => void;
}) {
  const [dest, setDest] = useState<LocationRef | null>(null);
  const [term, setTerm] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const search = useLocationSearch(warehouseId, dest ? '' : term);
  const putaway = usePutaway();

  useScanner((e) => {
    if (!dest) setTerm(e.code);
  });

  // 코드 완전일치 단건이면 자동 선택 — 이동 화면과 같은 규칙.
  useEffect(() => {
    if (dest) return;
    const trimmed = term.trim();
    if (!trimmed) return;
    const exact = (search.data?.items ?? []).filter((i) => i.code === trimmed);
    if (exact.length === 1) {
      setDest({ id: exact[0].id, code: exact[0].code });
      setTerm('');
    }
  }, [search.data, term, dest]);

  // 멱등키 회전: 대상지가 바뀌면 새 키. "커밋됐는데 응답만 유실" 뒤 대상지를
  // 고쳐 재제출할 때 옛 payload 를 같은 키로 replay 하는 사고를 막는다.
  const keyPayloadRef = useRef({ lineId: line.lineId, to: '' });
  useEffect(() => {
    const next = { lineId: line.lineId, to: dest?.id ?? '' };
    const prev = keyPayloadRef.current;
    if (prev.lineId === next.lineId && prev.to === next.to) return;
    keyPayloadRef.current = next;
    setIdempotencyKey(crypto.randomUUID());
  }, [line.lineId, dest]);

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="적치"
    >
      <div className="max-h-[90vh] w-full max-w-sm space-y-4 overflow-y-auto rounded-xl bg-white p-5 shadow-lg">
        <div>
          <div className="font-semibold text-gray-800">{line.skuName}</div>
          <div className="font-mono text-xs text-gray-500">{line.skuCode}</div>
          <div className="mt-1 text-xs text-gray-500">입고기본존 · {line.quantity}개를 적치합니다</div>
        </div>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-gray-700">대상 로케이션</h3>
          {dest ? (
            <div className="flex items-center gap-3 rounded-lg border border-blue-500 bg-blue-50 p-3">
              <span className="flex-1 font-medium text-gray-800">{dest.code}</span>
              <button type="button" className="text-xs text-blue-700 underline" onClick={() => setDest(null)}>
                변경
              </button>
            </div>
          ) : (
            <>
              {lastDest ? (
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
              ) : null}
              <ul className="space-y-1">
                {(search.data?.items ?? []).map((loc) => (
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
            </>
          )}
        </section>

        {putaway.isError ? (
          <p role="alert" className="text-sm text-red-600">
            {errorMessage(putaway.error, 'inbound')}
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
            disabled={!dest || putaway.isPending}
            onClick={() => {
              if (!dest) return;
              putaway.mutate(
                {
                  lineId: line.lineId,
                  toLocationId: dest.id,
                  quantity: line.quantity,
                  idempotencyKey,
                },
                { onSuccess: () => onDone(dest) }
              );
            }}
          >
            적치
          </Button>
        </div>
      </div>
    </div>
  );
}
