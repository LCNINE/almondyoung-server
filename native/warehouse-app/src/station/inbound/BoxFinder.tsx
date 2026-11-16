import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '../../core/data/ApiClientProvider';
import { errorMessage } from '../../core/data/errorMessage';
import { ApiError } from '../../core/data/httpClient';
import { cn } from '../../core/design/cn';
import { isCommandCode } from '../../core/hardware/scan/commandPrefix';
import { useHumanKeys, useScanEmit, useScanner } from '../../core/hardware/scan/useScanner';
import { findBoxes, listShipments } from '../../domains/inbound-shipment/api';
import type { BoxCandidate } from '../../domains/inbound-shipment/types';
import { useDigitCommands, useStationActions } from '../ActionRegistry';
import type { StationAction } from '../actions';
import { INBOUND_BOX_ACTIONS } from './inboundBoxActions';
import { arrivalDay, type InboundBoxesNotice } from './inboundBoxTypes';

/** 서버가 현장 문구로 보낸 400 사유(범위 표기 등)는 그대로, 나머지는 공용 문구 */
function findError(error: unknown): string {
  return error instanceof ApiError && error.status === 400 && error.serverMessage
    ? error.serverMessage
    : errorMessage(error);
}

const arrivalText = (expectedArrival: string | null) => {
  const day = arrivalDay(expectedArrival);
  return day ? ` · ${day} 도착` : '';
};

/**
 * 대기 — 상자 이름을 치거나 찍어 찾는다(스펙 §5.2). 정규화는 서버 몫이라 친 그대로 보낸다.
 * 0개면 안내(권한이 있으면 F12), 1개면 바로 열고, 2개 이상이면 `onChoose` 로 고르기에 넘긴다.
 */
export function WaitingForBox({
  warehouseId,
  canAddUnlisted,
  onOpen,
  onChoose,
  onAddUnlisted,
  say,
}: {
  warehouseId: string;
  canAddUnlisted: boolean;
  onOpen(shipmentId: string, boxId: string): void;
  onChoose(label: string, candidates: BoxCandidate[]): void;
  onAddUnlisted(label: string): void;
  say(notice: InboundBoxesNotice | null): void;
}) {
  const api = useApiClient();
  const emit = useScanEmit();
  const [draft, setDraft] = useState<string | null>(null);
  // 0개로 끝난 마지막 이름 — 안내 한 줄과 F12 가 이 이름으로 간다
  const [missing, setMissing] = useState<string | null>(null);
  const searching = useRef(false);
  const shipments = useQuery({
    queryKey: ['inbound-shipments', 'open', warehouseId],
    queryFn: () => listShipments(api, warehouseId, ['expected', 'receiving']),
  });

  const find = useCallback(
    async (raw: string) => {
      const label = raw.trim();
      if (label === '' || searching.current) return;
      searching.current = true;
      say(null);
      setMissing(null);
      try {
        const found = await findBoxes(api, warehouseId, label);
        if (found.length === 0) setMissing(label);
        else if (found.length === 1) onOpen(found[0].shipmentId, found[0].boxId);
        else onChoose(label, found);
      } catch (error) {
        say({ text: findError(error), tone: 'error' });
      } finally {
        searching.current = false;
      }
    },
    [api, warehouseId, onOpen, onChoose, say]
  );

  const findRef = useRef(find);
  findRef.current = find;
  useScanner(
    useCallback((event: { code: string }) => {
      setDraft(null);
      void findRef.current(event.code);
    }, [])
  );

  // 입력칸이 열려 있으면 칸이 키를 받는다(입력칸 포커스 중엔 사람 키가 오지 않는다)
  useHumanKeys(
    draft === null
      ? (key: string) => {
          if (key.length === 1) {
            say(null);
            setMissing(null);
            setDraft(key);
          }
        }
      : null
  );

  const submit = (raw: string) => {
    const value = raw.trim();
    setDraft(null);
    if (isCommandCode(value)) {
      emit({ code: value, source: 'hid', at: Date.now() });
      return;
    }
    void find(value);
  };

  const actions: StationAction[] = [
    ...(draft !== null
      ? [{ ...INBOUND_BOX_ACTIONS.back, label: '입력 닫기', enabled: true, run: () => setDraft(null) }]
      : []),
    ...(canAddUnlisted && missing !== null
      ? [{ ...INBOUND_BOX_ACTIONS.addUnlisted, enabled: true, run: () => onAddUnlisted(missing) }]
      : []),
  ];
  useStationActions(actions);

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 rounded-[10px] border border-[#D5D8DE] bg-white p-6">
      <div className="flex items-center gap-4">
        <p className="text-xl font-semibold">상자 이름을 입력하거나 스캔하세요</p>
        {draft !== null ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit(draft);
            }}
          >
            <input
              type="search"
              aria-label="상자 이름"
              autoFocus
              autoComplete="off"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="w-[260px] rounded-md border border-[#D5D8DE] bg-white px-3 py-2 font-mono text-2xl"
            />
          </form>
        ) : null}
      </div>
      {missing !== null ? (
        <p role="status" className="text-lg font-semibold text-[#7A4B00]">
          이 이름의 상자가 열린 선적에 없어요
        </p>
      ) : null}
      <section className="min-h-0 flex-1 overflow-auto">
        <h3 className="mb-2 text-lg font-semibold">열린 선적</h3>
        {shipments.isError ? (
          <p role="alert" className="font-semibold text-[#9E1320]">
            {errorMessage(shipments.error)}
          </p>
        ) : null}
        {shipments.data && shipments.data.length === 0 ? <p className="text-[#535968]">열린 선적이 없어요</p> : null}
        <ul className="space-y-1">
          {(shipments.data ?? []).map((s) => (
            <li key={s.id} className="text-lg">{`${s.name}${arrivalText(s.expectedArrival)} · 상자 ${s.boxCount}`}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/**
 * 고르기 — 같은 이름이 둘 이상의 선적에 있다(스펙 §5.3). 기본 선택 없음 — 커서가 처음엔 어느 줄에도 없고
 * Enter 만 쳐서는 안 열린다. 숫자(·숫자 명령 바코드)·↑↓+Enter·클릭으로 고른다.
 */
export function ChooseBox({
  label,
  candidates,
  onOpen,
  onBack,
}: {
  label: string;
  candidates: BoxCandidate[];
  onOpen(shipmentId: string, boxId: string): void;
  onBack(): void;
}) {
  const [cursor, setCursor] = useState(-1);
  const pick = useCallback(
    (index: number) => {
      const chosen = candidates[index];
      if (chosen) onOpen(chosen.shipmentId, chosen.boxId);
    },
    [candidates, onOpen]
  );
  const pickRef = useRef(pick);
  pickRef.current = pick;

  useHumanKeys((key: string) => {
    if (/^[1-9]$/.test(key)) pick(Number(key) - 1);
    else if (key === 'ArrowDown') setCursor(Math.min(cursor + 1, candidates.length - 1));
    else if (key === 'ArrowUp') setCursor(Math.max(cursor - 1, 0));
    else if (key === 'Enter' && cursor >= 0) pick(cursor);
  });
  useDigitCommands(useCallback((digit: number) => pickRef.current(digit - 1), []));
  useEffect(() => setCursor(-1), [candidates]);
  useStationActions([{ ...INBOUND_BOX_ACTIONS.back, enabled: true, run: onBack }]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 rounded-[10px] border border-[#D5D8DE] bg-white p-6">
      <p className="text-xl font-semibold">{`${label} 이 두 선적에 있어요. 고르세요.`}</p>
      <ul role="listbox" aria-label="선적 고르기" className="min-h-0 flex-1 overflow-auto">
        {candidates.map((c, index) => (
          <li key={`${c.shipmentId}:${c.boxId}`} role="option" aria-selected={index === cursor}>
            <button
              type="button"
              tabIndex={-1}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setCursor(index);
                pick(index);
              }}
              className={cn(
                'grid w-full grid-cols-[48px_minmax(0,1fr)] items-center gap-3 border-b border-[#E4E6EA] px-4 py-3 text-left',
                index === cursor && 'bg-[#E3ECFC]'
              )}
            >
              <span className="font-mono text-2xl font-semibold">{index + 1}</span>
              <span className="flex flex-col">
                <span className="text-lg font-semibold">{`${c.shipmentName}${arrivalText(c.expectedArrival)}`}</span>
                <span className="text-base text-[#535968]">{c.previewItems.join(', ')}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
