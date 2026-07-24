import { useEffect, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { errorMessage } from '../../core/data/errorMessage';
import { Button } from '../../core/design/Button';
import { ScreenHeader } from '../../core/design/ScreenHeader';
import { NumberPad } from '../../core/design/NumberPad';
import { cn } from '../../core/design/cn';
import { useScanner } from '../../core/hardware/scan/useScanner';
import { useStocktakingSession } from './queries';
import { useScanLocation, useScanProduct, useUpdateCount } from './mutations';
import type { ScanLocationItem, ScanLocationResult } from './types';

interface EditingLine {
  lineId: string;
  skuName: string;
  value: number;
}

export function SessionCountScreen({ sessionId }: { sessionId: string }) {
  const detail = useStocktakingSession(sessionId);
  const scanLocation = useScanLocation();
  const scanProduct = useScanProduct();
  const updateCount = useUpdateCount();

  /** 현재 위치의 화면 상태. scan-location 응답이 유일한 원천이다. */
  const [place, setPlace] = useState<ScanLocationResult | null>(null);
  const [manualCode, setManualCode] = useState('');
  const [editing, setEditing] = useState<EditingLine | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /** 서버가 준 절대 카운트로 라인 하나를 덮어쓴다. 낙관적 계산을 하지 않는다. */
  function applyCount(lineId: string, countedQuantity: number) {
    setPlace((prev) =>
      prev
        ? {
            ...prev,
            expectedItems: prev.expectedItems.map((i) =>
              i.lineId === lineId ? { ...i, countedQuantity, status: 'counted' } : i
            ),
          }
        : prev
    );
  }

  /**
   * 스캔 이벤트를 순서대로 하나씩 처리하는 큐. HID 스캐너는 wifi 왕복시간을
   * 쉽게 앞지르므로, 큐 없이 그냥 mutateAsync 를 여러 번 fire-and-forget 하면
   * 두 요청이 겹쳐 나간다 — 서버가 unlocked read-modify-write 라면 증가분이
   * 하나 사라지고, 서버가 정직해도 응답이 스캔 순서와 다르게 돌아오면 화면이
   * 더 작은(오래된) 절대값으로 되돌아갈 수 있다. isPending 조기 반환은 쓰지
   * 않는다 — 그건 두 번째 스캔을 "중복"으로 조용히 버리는 것과 같고, 여기서는
   * 버려진 스캔이 곧 사라진 카운트다(바코드-조회 화면의 중복 조회 드롭과 다름).
   */
  const scanQueueRef = useRef<Promise<unknown>>(Promise.resolve());

  async function enterLocation(code: string) {
    setNotice(null);
    try {
      const result = await scanLocation.mutateAsync({ sessionId, locationBarcode: code });
      setPlace(result);
      setManualCode('');
    } catch (e) {
      setNotice(errorMessage(e, 'location'));
    }
  }

  async function countProduct(barcode: string) {
    if (!place) return;
    setNotice(null);
    try {
      const result = await scanProduct.mutateAsync({
        sessionId,
        locationId: place.locationId,
        productBarcode: barcode,
        quantity: 1,
      });
      // 응답에 없던 라인(미기대 항목)이면 로케이션을 다시 읽어 목록에 넣는다.
      const known = place.expectedItems.some((i) => i.lineId === result.lineId);
      if (known) {
        applyCount(result.lineId, result.countedQuantity);
      } else {
        await enterLocation(place.locationCode);
      }
    } catch (e) {
      setNotice(errorMessage(e, 'barcode'));
    }
  }

  // 위치가 정해지기 전엔 로케이션 바코드를, 정해진 뒤엔 상품 바코드를 기대한다.
  // 수량 입력 다이얼로그가 떠 있거나(editing) 절대값 저장이 아직 진행 중이면
  // (updateCount.isPending) 스캔을 통째로 무시한다 — HID 리더기는 전역 keydown 이라
  // 다이얼로그 뒤에서 countProduct 가 돌면 이중 카운트가 난다. onSave 가
  // setEditing(null) 을 낙관적으로 먼저 불러 다이얼로그를 닫으므로, editing 만
  // 보면 PUT 이 아직 날아가는 중에도 이 가드가 풀려버린다 — isPending 을
  // 같이 봐야 한다.
  useScanner((e) => {
    if (editing || updateCount.isPending) return;
    scanQueueRef.current = scanQueueRef.current
      .then(() => (place ? countProduct(e.code) : enterLocation(e.code)))
      .catch(() => {
        // countProduct/enterLocation 은 이미 자기 에러를 notice 로 흡수한다 —
        // 여기서는 체인이 끊겨 다음 스캔이 영영 대기하는 것만 막는다.
      });
  });

  const progress = detail.data?.progress;

  return (
    <div className="space-y-4">
      <ScreenHeader
        title={detail.data?.sessionName ?? '실사'}
        backTo="/stocktaking"
        right={
          progress ? (
            <span data-testid="progress">
              {progress.counted} / {progress.total}
            </span>
          ) : null
        }
      />

      {detail.isError ? (
        <p role="alert" className="text-sm text-red-600">
          {errorMessage(detail.error, 'stocktaking')}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="text-sm text-amber-700">
          {notice}
        </p>
      ) : null}

      {place === null ? (
        <section className="space-y-3">
          <div className="rounded-xl border border-dashed border-blue-300 bg-blue-50 p-8 text-center">
            <p className="text-base font-semibold text-blue-800">로케이션 바코드를 스캔하세요</p>
            <p className="mt-1 text-xs text-blue-700">스캔하면 그 위치의 상품이 나와요.</p>
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (manualCode.trim()) void enterLocation(manualCode.trim());
            }}
          >
            <label htmlFor="loc-manual" className="sr-only">
              로케이션 코드 직접 입력
            </label>
            <input
              id="loc-manual"
              className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
              placeholder="코드 직접 입력"
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
            />
            <Button type="submit" disabled={scanLocation.isPending}>
              열기
            </Button>
          </form>
        </section>
      ) : (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="flex-1 rounded-lg border border-blue-500 bg-blue-50 px-3 py-2 font-semibold text-blue-800">
              {place.locationCode}
            </span>
            <Button
              type="button"
              className="border border-gray-300 bg-white text-gray-800 hover:bg-gray-50"
              onClick={() => setPlace(null)}
            >
              다른 로케이션
            </Button>
          </div>

          <p className="text-xs text-gray-500">
            상품 바코드를 스캔하면 1개씩 올라가요. 박스 단위는 수량 입력을 쓰세요.
          </p>

          <ul className="space-y-2">
            {place.expectedItems.map((item) => (
              <LineRow
                key={item.lineId}
                item={item}
                onEdit={() =>
                  setEditing({
                    lineId: item.lineId,
                    skuName: item.skuName,
                    value: item.countedQuantity ?? 0,
                  })
                }
              />
            ))}
          </ul>
        </section>
      )}

      <Link to="/stocktaking/$sessionId/variances" params={{ sessionId }}>
        <Button className="w-full py-3">차이 확인 →</Button>
      </Link>

      <QuantityDialog
        editing={editing}
        pending={updateCount.isPending}
        onCancel={() => setEditing(null)}
        onChange={(v) => setEditing((prev) => (prev ? { ...prev, value: v } : prev))}
        onSave={async () => {
          const target = editing;
          setEditing(null);
          if (!target) return;
          try {
            const result = await updateCount.mutateAsync({
              sessionId,
              lineId: target.lineId,
              countedQuantity: target.value,
            });
            applyCount(result.lineId, result.countedQuantity);
          } catch (e) {
            setNotice(errorMessage(e, 'stocktaking'));
          }
        }}
      />
    </div>
  );
}

function LineRow({ item, onEdit }: { item: ScanLocationItem; onEdit: () => void }) {
  const counted = item.countedQuantity;
  const diff = counted === null ? null : counted - item.expectedQuantity;
  return (
    <li className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-3">
      <span className="flex-1">
        <span className="block font-medium text-gray-800">{item.skuName}</span>
        <span className="block font-mono text-xs text-gray-500">{item.skuCode}</span>
      </span>
      <span className="text-center">
        <span className="block text-xs text-gray-500">예상</span>
        <span className="block text-sm text-gray-700">{item.expectedQuantity}</span>
      </span>
      <span className="text-center">
        <span className="block text-xs text-gray-500">카운트</span>
        <span
          data-testid={`count-${item.lineId}`}
          className={cn(
            'block text-lg font-semibold',
            counted === null && 'text-gray-400',
            diff !== null && diff === 0 && 'text-gray-900',
            diff !== null && diff !== 0 && 'text-red-600'
          )}
        >
          {counted === null ? '—' : counted}
        </span>
      </span>
      <Button
        type="button"
        aria-label={`${item.skuName} 수량 입력`}
        className="px-3 py-1.5 text-xs"
        onClick={onEdit}
      >
        수량
      </Button>
    </li>
  );
}

/**
 * 수량 직접 입력 다이얼로그. Task 6 의 ConfirmDialog 와 달리 자체 마크업이라
 * 포커스·Escape 처리를 여기서 직접 한다 — 같은 이유로 버튼은 절대 포커스하지
 * 않는다(패널만 포커스). HID 스캐너는 종단에 Enter 를 보내는데, 포커스가
 * 저장 버튼에 가 있으면 그 Enter 가 저장을 눌러버려 다이얼로그가 열린 채로
 * 스캔한 셈이 된다 — 다이얼로그가 죽어있어야 할 스캔 경로가 버튼 포커스로
 * 되살아나는 것과 같은 사고이므로 패널에 포커스하고 Enter 는 흡수한다.
 */
function QuantityDialog({
  editing,
  pending,
  onCancel,
  onChange,
  onSave,
}: {
  editing: EditingLine | null;
  pending: boolean;
  onCancel: () => void;
  onChange: (v: number) => void;
  onSave: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (editing) {
      previouslyFocusedRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      panelRef.current?.focus();
    } else {
      previouslyFocusedRef.current?.focus();
      previouslyFocusedRef.current = null;
    }
  }, [editing]);

  useEffect(() => {
    if (!editing) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [editing, onCancel]);

  if (!editing) return null;

  // 스캐너의 종단 Enter 는 포커스가 어디에 있든 여기서 흡수한다 — 실제 저장은
  // pointer/touch tap 으로만 가능해야 한다(ConfirmDialog 와 같은 방어).
  function handlePanelKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Enter' || e.code === 'NumpadEnter') {
      e.preventDefault();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${editing.skuName} 수량`}
        tabIndex={-1}
        onKeyDown={handlePanelKeyDown}
        className="w-full max-w-sm space-y-3 rounded-xl bg-white p-5 shadow-lg outline-none"
      >
        <h2 className="text-base font-semibold text-gray-900">{editing.skuName}</h2>
        <div className="rounded-lg border border-gray-200 p-3 text-center text-2xl font-semibold text-gray-900">
          {editing.value}
        </div>
        <NumberPad value={editing.value} onChange={onChange} />
        <div className="flex gap-2">
          <Button
            type="button"
            className="flex-1 border border-gray-300 bg-white text-gray-800 hover:bg-gray-50"
            onClick={onCancel}
          >
            취소
          </Button>
          <Button type="button" className="flex-1" disabled={pending} onClick={onSave}>
            저장
          </Button>
        </div>
      </div>
    </div>
  );
}
