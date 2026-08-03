import { useEffect, useRef, useState } from 'react';
import { useWarehouse } from '../../app/warehouse-context';
import { errorMessage } from '../../core/data/errorMessage';
import { ScreenHeader } from '../../core/design/ScreenHeader';
import { useScanner } from '../../core/hardware/scan/useScanner';
import { useSkuByBarcode } from '../inventory/useSkuByBarcode';
import { WarehousePicker } from '../warehouse/WarehousePicker';
import { PutawaySheet, type LocationRef } from './PutawaySheet';
import { usePutawayPending, type PutawayDays } from './queries';
import type { PutawayPendingItem } from './types';

// 서버 리더의 LIMIT(200)과 같은 값 — truncated 안내 문구에 실제 상한을 보여준다.
const PENDING_DISPLAY_LIMIT = 200;

const DAY_OPTIONS: Array<{ value: PutawayDays; label: string }> = [
  { value: 1, label: '최근 1일' },
  { value: 7, label: '최근 7일' },
  { value: 'all', label: '전체' },
];

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function PutawayQueueScreen() {
  const { warehouseId, isSet } = useWarehouse();
  const [days, setDays] = useState<PutawayDays>(1);
  // target 은 큐 데이터에서 매 렌더 다시 찾지 않는다 — 시트를 여는 순간의
  // 스냅샷이다. 백그라운드 refetch 로 pendingQty 가 바뀌어도 작업자가 입력
  // 중인 수량은 지워지지 않는다(서버가 실제 잔량을 재검증하므로 낡아도 안전).
  const [target, setTarget] = useState<PutawayPendingItem | null>(null);
  const [candidates, setCandidates] = useState<PutawayPendingItem[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [lastDest, setLastDest] = useState<LocationRef | null>(null);

  const queue = usePutawayPending(warehouseId, days);
  const byBarcode = useSkuByBarcode();
  const items = queue.data?.items ?? [];

  // 안내(notice)와 미등록 바코드 오류 배너(byBarcode.reset)는 항상 같이
  // 지운다 — 한쪽만 지우면 낡은 문구/배너가 다음 상태에 남아 보인다.
  const clearScanFeedback = () => {
    setNotice(null);
    byBarcode.reset();
  };

  // items 는 이 렌더의 스냅샷이라 스캔 시점과 byBarcode 응답 시점 사이(왕복 중)
  // days 나 창고가 바뀌면 onSuccess 클로저는 옛 값을 본다 — ref 로 항상 최신
  // 값을 읽는다. isSuccess 도 items 와 한 ref 에 같이 미러링한다 — 따로
  // 두면 "그 사이 큐가 pending 으로 떨어졌다"는 사실과 "그때 items 가 무엇
  // 이었나"가 서로 다른 시점의 값으로 섞여, 큐가 아직 준비 안 된 순간에도
  // (placeholderData 가 없어 data 가 undefined 로 비므로) items=[] 를 "결과
  // 없음"으로 오판하게 된다.
  const queueRef = useRef({ isSuccess: queue.isSuccess, items });
  queueRef.current = { isSuccess: queue.isSuccess, items };

  // 기간 필터가 바뀌면 items 가 통째로 바뀌므로 그 이전 스캔에 대한 안내도
  // 미등록 바코드 오류 배너도 더는 근거가 없다 — 둘 다 clearScanFeedback 으로
  // 같이 지운다(한쪽만 지우면 다른 쪽이 새 필터 결과 위에 낡은 채로 남는다).
  useEffect(() => {
    clearScanFeedback();
  }, [days]);

  // 스캔은 큐를 좁히는 지름길이다. 서버가 아니라 이미 받은 목록에서 거르므로
  // "큐에 없음"과 "조회 실패"를 화면이 구분해 말할 수 있다.
  useScanner((e) => {
    if (target) return;
    // 새 스캔은 이전 화면 상태를 전부 무효화한다 — 안내 문구도, 아직 열려
    // 있는 후보 목록도 이 스캔이 정한 새 결과로 교체돼야 한다. 안 지우면
    // 후보 다이얼로그가 열려 있는 채로 다음 스캔이 1건으로 좁혀졌을 때
    // 시트와 다이얼로그가 동시에 화면에 남는다.
    clearScanFeedback();
    setCandidates(null);
    // 큐가 아직 안 왔거나(로딩) 조회에 실패했으면 items 는 [] 다 — 그 상태로
    // 스캔을 걸러버리면 "이 상품은 적치 대기가 없어요"가 거짓이 된다("없음"과
    // "아직 모름"은 다른 사실이다). 준비 안 된 상태에서는 아예 거르지 않는다.
    if (!queue.isSuccess) {
      setNotice('목록을 아직 못 불러왔어요. 잠시 후 다시 스캔해 주세요.');
      return;
    }
    byBarcode.mutate(e.code, {
      onSuccess: (skus) => {
        // 스캔 시점엔 큐가 준비돼 있었더라도, 바코드 조회가 왕복하는 사이
        // days/창고가 바뀌어 큐가 다시 pending 으로 떨어졌을 수 있다 — 그 경우
        // items 는 일시적으로 [] 인데, 그걸 "결과 없음"으로 오판하면 안 된다.
        // 응답이 도착한 지금 시점의 준비 상태를 다시 확인한다.
        if (!queueRef.current.isSuccess) {
          setNotice('목록을 아직 못 불러왔어요. 잠시 후 다시 스캔해 주세요.');
          return;
        }
        const ids = new Set(skus.map((s) => s.id));
        const hits = queueRef.current.items.filter((i) => ids.has(i.skuId));
        if (hits.length === 0) {
          setNotice('이 상품은 적치 대기가 없어요.');
          return;
        }
        if (hits.length === 1) {
          setTarget(hits[0]);
          return;
        }
        setCandidates(hits);
      },
    });
  });

  if (!isSet) {
    return (
      <div className="space-y-4">
        <ScreenHeader title="적치" backTo="/" />
        <div className="space-y-3 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4">
          <p className="text-sm text-gray-600">창고를 먼저 선택해 주세요.</p>
          <WarehousePicker />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 로딩 중엔 아직 진짜 건수를 모른다 — "0건"으로 보이면 다 봤다는 오해를 준다. */}
      <ScreenHeader
        title="적치"
        backTo="/"
        right={queue.isSuccess ? `${items.length}${queue.data.truncated ? '건+' : '건'}` : undefined}
      />

      <div className="flex gap-2">
        {DAY_OPTIONS.map((o) => (
          <button
            key={String(o.value)}
            type="button"
            aria-pressed={days === o.value}
            className={
              days === o.value
                ? 'rounded-md border border-blue-500 bg-blue-50 px-3 py-1.5 text-sm text-blue-700'
                : 'rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700'
            }
            onClick={() => setDays(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>

      <p className="text-sm text-gray-500">상품 바코드를 스캔하거나 목록에서 고르세요.</p>

      {notice ? (
        <p role="status" className="text-sm text-amber-700">
          {notice}
        </p>
      ) : null}
      {byBarcode.isError ? (
        <p role="alert" className="text-sm text-red-600">
          {errorMessage(byBarcode.error, 'barcode')}
        </p>
      ) : null}

      {queue.isError ? (
        <p role="alert" className="text-sm text-red-600">
          {errorMessage(queue.error, 'putaway')}
        </p>
      ) : queue.isLoading ? (
        <p className="text-sm text-gray-500">불러오는 중…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-gray-500">
          적치할 항목이 없어요.{days === 'all' ? '' : ' 기간 필터를 넓혀 보세요.'}
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.lineId}>
              <button
                type="button"
                className="flex w-full items-center gap-3 rounded-lg border border-gray-200 bg-white p-3 text-left active:bg-gray-50"
                onClick={() => {
                  // 낡은 "적치 대기 없음" 안내와 미등록 바코드 오류 배너는 이 탭으로
                  // 더는 사실이 아니게 된다.
                  clearScanFeedback();
                  setTarget(item);
                }}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-gray-800">{item.skuName}</span>
                  <span className="block text-xs text-gray-500">
                    {item.originLocationCode} · {formatTime(item.receivedAt)}
                  </span>
                </span>
                <span className="shrink-0 rounded-full bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">
                  잔여 {item.pendingQty}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {queue.data?.truncated ? (
        <p className="text-xs text-amber-700">
          오래된 순으로 {PENDING_DISPLAY_LIMIT}건만 표시 중이에요. 기간을 좁혀서 나머지를 확인하세요.
        </p>
      ) : null}

      {candidates ? (
        <div
          className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-label="적치 대상 선택"
        >
          <div className="w-full max-w-sm space-y-3 rounded-xl bg-white p-5 shadow-lg">
            <h2 className="font-semibold text-gray-800">어느 건을 적치할까요?</h2>
            <ul className="space-y-2">
              {candidates.map((c) => (
                <li key={c.lineId}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 rounded-lg border border-gray-200 p-3 text-left active:bg-gray-50"
                    onClick={() => {
                      clearScanFeedback();
                      setTarget(c);
                      setCandidates(null);
                    }}
                  >
                    <span className="flex-1 text-sm text-gray-700">
                      {formatTime(c.receivedAt)} 입고 · {c.originLocationCode}
                    </span>
                    <span className="text-sm font-semibold text-gray-900">{c.pendingQty}개</span>
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="w-full rounded-md border border-gray-300 py-2 text-sm text-gray-700"
              onClick={() => setCandidates(null)}
            >
              닫기
            </button>
          </div>
        </div>
      ) : null}

      {target ? (
        <PutawaySheet
          target={target}
          warehouseId={warehouseId}
          lastDest={lastDest}
          onCancel={() => {
            clearScanFeedback();
            setTarget(null);
          }}
          onDone={(dest) => {
            clearScanFeedback();
            setLastDest(dest);
            setTarget(null);
            // 잔량이 남으면 무효화된 큐가 줄어든 수량으로 다시 내려준다.
          }}
        />
      ) : null}
    </div>
  );
}
