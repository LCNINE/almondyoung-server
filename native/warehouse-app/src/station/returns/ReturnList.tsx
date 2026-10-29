import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from '../../core/data/errorMessage';
import { cn } from '../../core/design/cn';
import { isCommandCode } from '../../core/hardware/scan/commandPrefix';
import { useHumanKeys, useScanEmit, useScanner } from '../../core/hardware/scan/useScanner';
import { useReceivingReturns } from '../../domains/customer-returns/api';
import { RETURN_REASON_LABELS, SELLER_BORNE_REASONS } from '../../domains/customer-returns/reasons';
import type { ReceivingItem } from '../../domains/customer-returns/types';
import { useStationActions } from '../ActionRegistry';
import type { StationAction } from '../actions';
import { useFeedback } from '../feedback/FeedbackProvider';
import { RETURNS_ACTIONS } from './returnsActions';

/** 목록이 보여 주는 단계 글자 — 도착 대기는 정상이라 글자가 없다 */
const STAGE_LABEL: Record<ReceivingItem['stage'], string | null> = {
  ready: '검수 대기',
  partial: '덜 옴',
  awaiting: null,
};

const NO_FILTER = { q: '', barcode: '' };

/**
 * 도착 대기 목록(N3) — 위가 먼저 할 일(검수 대기 → 덜 옴 → 도착 대기, 서버가 정렬한다).
 * F9·숫자 = 검색, 상품 스캔 = 그 상품의 반품(하나면 바로 연다, N5), ↑↓·Enter·클릭 = 연다.
 */
export function ReturnList({
  warehouseId,
  onOpen,
  onActivity,
}: {
  warehouseId: string;
  onOpen(id: string): void;
  /** 작업자가 새로 무언가 했다 — 앞 안내를 지운다 */
  onActivity(): void;
}) {
  const { signal } = useFeedback();
  const emit = useScanEmit();
  const [filter, setFilter] = useState(NO_FILTER);
  const [draft, setDraft] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);
  // 찍은 상품 — 그 조회 결과가 오면 하나일 때 연다
  const [scanned, setScanned] = useState<string | null>(null);
  // 검색칸에 친(찍힌) 숫자 — 주문번호로 0건이면 상품 바코드로 한 번 더 찾는다(입력칸 포커스 중엔 스캔이 버스로 안 온다)
  const [digits, setDigits] = useState<string | null>(null);
  const query = useReceivingReturns(warehouseId, filter);
  const items = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const cursor = Math.min(selected, Math.max(items.length - 1, 0));
  const filtered = filter.q !== '' || filter.barcode !== '';

  const apply = (next: typeof NO_FILTER) => {
    onActivity();
    setDraft(null);
    setSelected(0);
    setFilter(next);
  };

  useEffect(() => {
    if (digits === null || filter.q !== digits || query.data === undefined) return;
    setDigits(null);
    if (query.data.items.length > 0) return;
    setFilter({ q: '', barcode: digits });
    setScanned(digits);
  }, [digits, filter.q, query.data]);

  useEffect(() => {
    if (scanned === null || filter.barcode !== scanned || query.data === undefined) return;
    setScanned(null);
    if (query.data.items.length === 1) onOpen(query.data.items[0].id);
    else if (query.data.items.length === 0) signal('error');
  }, [scanned, filter.barcode, query.data, onOpen, signal]);

  const onScan = (code: string) => {
    apply({ q: '', barcode: code });
    setScanned(code);
  };
  const scanRef = useRef(onScan);
  scanRef.current = onScan;
  useScanner(useCallback((event: { code: string }) => scanRef.current(event.code), []));

  // 검색칸이 열려 있으면 칸이 키를 받는다(입력칸 포커스 중엔 사람 키가 오지 않는다)
  useHumanKeys(
    draft === null
      ? (key: string) => {
          if (/^\d$/.test(key)) {
            onActivity();
            setDraft(key);
          } else if (key === 'ArrowDown') setSelected(Math.min(cursor + 1, Math.max(items.length - 1, 0)));
          else if (key === 'ArrowUp') setSelected(Math.max(cursor - 1, 0));
          else if (key === 'Enter' && items[cursor]) onOpen(items[cursor].id);
        }
      : null
  );

  /** 검색칸 Enter — 명령 바코드는 버스로 보내 셸이 받게(스펙 §5.3), 아니면 검색 */
  const submit = (raw: string) => {
    const value = raw.trim();
    if (isCommandCode(value)) {
      setDraft(null);
      emit({ code: value, source: 'hid', at: Date.now() });
      return;
    }
    apply({ q: value, barcode: '' });
    setDigits(/^\d+$/.test(value) ? value : null);
  };

  // Esc: 칸이 열려 있으면 칸만 닫는다(걸린 검색은 남는다), 닫혀 있으면 걸린 검색을 지운다
  const escape: StationAction[] =
    draft !== null
      ? [{ ...RETURNS_ACTIONS.clear, label: '검색 닫기', enabled: true, run: () => setDraft(null) }]
      : filtered
        ? [{ ...RETURNS_ACTIONS.clear, enabled: true, run: () => apply(NO_FILTER) }]
        : [];
  const actions: StationAction[] = [
    { ...RETURNS_ACTIONS.search, enabled: true, run: () => setDraft((current) => current ?? filter.q) },
    ...escape,
  ];
  useStationActions(actions);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {draft !== null ? (
        <form
          className="shrink-0"
          onSubmit={(e) => {
            e.preventDefault();
            submit(draft);
          }}
        >
          <input
            type="search"
            aria-label="반품 검색"
            autoFocus
            autoComplete="off"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="w-[420px] rounded-md border border-[#D5D8DE] bg-white px-3 py-2 text-2xl"
          />
        </form>
      ) : filtered ? (
        <p className="shrink-0 text-lg font-semibold">{filter.q || filter.barcode}</p>
      ) : null}
      {query.isError ? (
        <p role="alert" className="font-semibold text-[#9E1320]">
          {errorMessage(query.error)}
        </p>
      ) : null}
      {query.data && items.length === 0 ? (
        <p className="p-6 text-lg text-[#535968]">{filtered ? '찾는 반품이 없어요' : '도착 대기 반품이 없어요'}</p>
      ) : null}
      {items.length > 0 ? (
        <ul
          role="listbox"
          aria-label="도착 대기 반품"
          className="min-h-0 flex-1 overflow-auto rounded-[10px] border border-[#D5D8DE] bg-white"
        >
          {items.map((item, index) => (
            <ReturnRow
              key={item.id}
              item={item}
              selected={index === cursor}
              onOpen={() => {
                // 누른 행이 ↑↓ 선택이 된다 — 열기가 실패해도 Enter 가 같은 행을 연다
                setSelected(index);
                onOpen(item.id);
              }}
            />
          ))}
        </ul>
      ) : null}
      {total > items.length ? (
        <p className="shrink-0 text-[#535968]">{`외 ${total - items.length}건 — 검색하세요`}</p>
      ) : null}
    </div>
  );
}

function ReturnRow({ item, selected, onOpen }: { item: ReceivingItem; selected: boolean; onOpen(): void }) {
  const stage = STAGE_LABEL[item.stage];
  const ref = useRef<HTMLLIElement>(null);
  // ↑↓ 로 고른 행이 화면 밖이면 따라간다(jsdom 엔 scrollIntoView 가 없다)
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView?.({ block: 'nearest' });
  }, [selected]);
  return (
    <li
      ref={ref}
      role="option"
      aria-selected={selected}
      data-order-no={item.orderNo}
      className="border-b border-[#E4E6EA]"
    >
      {/* 포커스를 받지 않는다 — 누른 뒤 Enter 가 단추 클릭과 사람 Enter 로 두 번 열지 않게 */}
      <button
        type="button"
        tabIndex={-1}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onOpen}
        className={cn(
          'grid h-14 w-full grid-cols-[180px_120px_140px_minmax(0,1fr)_96px_96px] items-center px-4 text-left text-base',
          selected && 'bg-[#E3ECFC]'
        )}
      >
        <span className="font-mono font-semibold">{item.orderNo}</span>
        <span>{item.customerMasked}</span>
        <span className={cn(SELLER_BORNE_REASONS.has(item.reason) && 'font-semibold')}>
          {RETURN_REASON_LABELS.get(item.reason) ?? item.reason}
        </span>
        <span className="truncate">{item.productSummary}</span>
        <span className="text-right font-mono">
          {item.stage === 'awaiting' ? item.expectedQty : `${item.arrivedQty}/${item.expectedQty}`}
        </span>
        <span className={cn('text-right font-semibold', item.stage === 'ready' ? 'text-[#123E99]' : 'text-[#7A4B00]')}>
          {stage}
        </span>
      </button>
    </li>
  );
}
