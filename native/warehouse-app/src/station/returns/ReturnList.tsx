import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { errorMessage } from '../../core/data/errorMessage';
import { cn } from '../../core/design/cn';
import { ScreenHeader } from '../../core/design/ScreenHeader';
import { isCommandCode } from '../../core/hardware/scan/commandPrefix';
import {
  useHumanKeys,
  useScanEmit,
  useScanner,
} from '../../core/hardware/scan/useScanner';
import { useReceivingReturns } from '../../domains/customer-returns/api';
import { KIND_LABEL } from '../../domains/customer-returns/outcome';
import {
  RETURN_REASON_LABELS,
  SELLER_BORNE_REASONS,
} from '../../domains/customer-returns/reasons';
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
 * F9·숫자 = 검색, 상품 스캔 = 그 상품의 반품(하나면 바로 연다, N5 — 연 반품의 소포가 그 한 개를 센다), ↑↓·Enter·클릭 = 연다.
 */
export function ReturnList({
  warehouseId,
  onOpen,
  onActivity,
}: {
  warehouseId: string;
  /** scanned — 스캐너로 찍어 열었으면 그 바코드(검색칸에 친 숫자는 싣지 않는다) */
  onOpen(id: string, scanned?: string): void;
  /** 작업자가 새로 무언가 했다 — 앞 안내를 지운다 */
  onActivity(): void;
}) {
  const { signal } = useFeedback();
  const emit = useScanEmit();
  const [filter, setFilter] = useState(NO_FILTER);
  const [draft, setDraft] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);
  // 찍은 상품 — 그 조회 결과가 오면 하나일 때 연다. fromScanner 면 열린 소포가 그 한 개를 센다
  const [scanned, setScanned] = useState<{
    code: string;
    fromScanner: boolean;
  } | null>(null);
  // 검색칸에 친(찍힌) 숫자 — 주문번호로 0건이면 상품 바코드로 한 번 더 찾는다(입력칸 포커스 중엔 스캔이 버스로 안 온다)
  const [digits, setDigits] = useState<string | null>(null);
  const query = useReceivingReturns(warehouseId, filter);
  const overall = useReceivingReturns(warehouseId, NO_FILTER);
  const items = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const cursor = Math.min(selected, Math.max(items.length - 1, 0));
  const overallItems = overall.data?.items ?? [];
  const overallReady = overallItems.filter(
    (item) => item.stage === 'ready'
  ).length;
  const readyTruncated =
    overall.data !== undefined &&
    overall.data.total > overallItems.length &&
    overallReady === overallItems.length;
  const readyBadge = overall.data
    ? `${overallReady}건${readyTruncated ? ' 이상' : ''}`
    : null;
  const readyItems = items.filter((item) => item.stage === 'ready');
  const waitingItems = items.filter((item) => item.stage !== 'ready');
  const filtered = filter.q !== '' || filter.barcode !== '';

  const apply = (next: typeof NO_FILTER) => {
    onActivity();
    setDraft(null);
    setSelected(0);
    setFilter(next);
  };

  useEffect(() => {
    if (digits === null || filter.q !== digits || query.data === undefined)
      return;
    setDigits(null);
    if (query.data.items.length > 0) return;
    setFilter({ q: '', barcode: digits });
    setScanned({ code: digits, fromScanner: false });
  }, [digits, filter.q, query.data]);

  useEffect(() => {
    if (
      scanned === null ||
      filter.barcode !== scanned.code ||
      query.data === undefined
    )
      return;
    setScanned(null);
    if (query.data.items.length === 1)
      onOpen(
        query.data.items[0].id,
        scanned.fromScanner ? scanned.code : undefined
      );
    else if (query.data.items.length === 0) signal('error');
  }, [scanned, filter.barcode, query.data, onOpen, signal]);

  const openRow = (item: ReceivingItem, index: number) => {
    // 누른 행이 ↑↓ 선택이 된다 — 열기가 실패해도 Enter 가 같은 행을 연다
    setSelected(index);
    onOpen(item.id);
  };

  const onScan = (code: string) => {
    apply({ q: '', barcode: code });
    setScanned({ code, fromScanner: true });
  };
  const scanRef = useRef(onScan);
  scanRef.current = onScan;
  useScanner(
    useCallback((event: { code: string }) => scanRef.current(event.code), [])
  );

  // 검색칸이 열려 있으면 칸이 키를 받는다(입력칸 포커스 중엔 사람 키가 오지 않는다)
  useHumanKeys(
    draft === null
      ? (key: string) => {
          if (/^\d$/.test(key)) {
            onActivity();
            setDraft(key);
          } else if (key === 'ArrowDown')
            setSelected(Math.min(cursor + 1, Math.max(items.length - 1, 0)));
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
      ? [
          {
            ...RETURNS_ACTIONS.clear,
            label: '검색 닫기',
            enabled: true,
            run: () => setDraft(null),
          },
        ]
      : filtered
        ? [
            {
              ...RETURNS_ACTIONS.clear,
              enabled: true,
              run: () => apply(NO_FILTER),
            },
          ]
        : [];
  const actions: StationAction[] = [
    {
      ...RETURNS_ACTIONS.search,
      enabled: true,
      run: () => setDraft((current) => current ?? filter.q),
    },
    ...escape,
  ];
  useStationActions(actions);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <ScreenHeader
        title="반품"
        description="돌아온 상품의 상태와 수량을 확인하세요."
      />
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
            className="w-[420px] rounded-lg border border-[#e4e4e7] bg-white px-3 py-2.5 text-base text-[#27272a]"
          />
        </form>
      ) : filtered ? (
        <p className="shrink-0 text-base font-semibold text-[#27272a]">
          {filter.q || filter.barcode}
        </p>
      ) : null}
      {query.isError ? (
        <p
          role="alert"
          className="rounded-[10px] border border-[#efcbc4] bg-[#fff4f1] px-4 py-3 text-[13px] font-semibold text-[#aa4037]"
        >
          {errorMessage(query.error)}
        </p>
      ) : null}
      {query.data && items.length === 0 ? (
        <p className="rounded-xl border border-[#e4e4e7] bg-white p-6 text-[13px] text-[#71717a]">
          {filtered ? '찾는 반품이 없어요' : '도착 대기 반품이 없어요'}
        </p>
      ) : null}
      {readyItems.length > 0 ? (
        <ReturnCard title="검수 대기" badge={readyBadge} label="검수 대기 반품">
          {readyItems.map((item, index) => (
            <ReturnRow
              key={item.id}
              item={item}
              selected={index === cursor}
              onOpen={() => openRow(item, index)}
            />
          ))}
        </ReturnCard>
      ) : null}
      {waitingItems.length > 0 ? (
        <ReturnCard
          title="도착 대기"
          badge={`${waitingItems.length}건`}
          label="도착 대기 반품"
        >
          {waitingItems.map((item, index) => (
            <ReturnRow
              key={item.id}
              item={item}
              selected={readyItems.length + index === cursor}
              onOpen={() => openRow(item, readyItems.length + index)}
            />
          ))}
        </ReturnCard>
      ) : null}
      {total > items.length ? (
        <p className="shrink-0 text-[13px] text-[#71717a]">{`외 ${total - items.length}건 — 검색하세요`}</p>
      ) : null}
    </div>
  );
}

function ReturnCard({
  title,
  badge,
  label,
  children,
}: {
  title: string;
  badge: string | null;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-0 shrink-0 flex-col overflow-hidden rounded-xl border border-[#e4e4e7] bg-white">
      <div className="flex shrink-0 items-center justify-between border-b border-[#e4e4e7] px-5 py-3.5">
        <h2 className="text-sm font-bold text-[#27272a]">{title}</h2>
        {badge ? (
          <span className="rounded-full bg-[#eff6ff] px-2.5 py-1 text-xs font-semibold text-[#2563eb]">
            {badge}
          </span>
        ) : null}
      </div>
      <ul
        role="listbox"
        aria-label={label}
        className="min-h-0 flex-1 overflow-auto"
      >
        {children}
      </ul>
    </div>
  );
}

function ReturnRow({
  item,
  selected,
  onOpen,
}: {
  item: ReceivingItem;
  selected: boolean;
  onOpen(): void;
}) {
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
      className="border-b border-[#f0f0f2] last:border-b-0"
    >
      {/* 포커스를 받지 않는다 — 누른 뒤 Enter 가 단추 클릭과 사람 Enter 로 두 번 열지 않게 */}
      <button
        type="button"
        tabIndex={-1}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onOpen}
        className={cn(
          'flex w-full items-center gap-3.5 px-5 py-3 text-left',
          selected && 'bg-[#eff6ff]'
        )}
      >
        <span
          data-slot="thumbnail"
          aria-hidden
          className="h-11 w-11 shrink-0 rounded-lg border border-[#e4e4e7] bg-[#f4f4f5]"
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold text-[#27272a]">
            {item.productSummary}
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2.5 text-xs text-[#71717a]">
            <span className="font-mono">{item.orderNo}</span>
            <span>{item.customerMasked}</span>
            <span
              className={cn(
                SELLER_BORNE_REASONS.has(item.reason) &&
                  'font-semibold text-[#27272a]'
              )}
            >
              {RETURN_REASON_LABELS.get(item.reason) ?? item.reason}
            </span>
          </span>
        </span>
        <span data-col="kind" className="shrink-0">
          {item.kind ? (
            <span
              className={cn(
                'rounded-[5px] px-2 py-[5px] text-[11px] font-semibold',
                item.kind === 'exchange'
                  ? 'bg-[#2563eb] text-white'
                  : 'bg-[#f4f4f5] text-[#27272a]'
              )}
            >
              {KIND_LABEL[item.kind]}
            </span>
          ) : null}
        </span>
        <span className="w-14 shrink-0 text-right font-mono text-sm text-[#27272a]">
          {item.stage === 'awaiting'
            ? item.expectedQty
            : `${item.arrivedQty}/${item.expectedQty}`}
        </span>
        <span className="w-16 shrink-0 text-right">
          {stage ? (
            <span
              className={cn(
                'inline-flex rounded-[5px] px-2 py-[5px] text-[11px] font-semibold',
                item.stage === 'ready'
                  ? 'bg-[#eff6ff] text-[#2563eb]'
                  : 'bg-[#fff7e6] text-[#9a681c]'
              )}
            >
              {stage}
            </span>
          ) : null}
        </span>
        <span className="shrink-0 rounded-lg bg-[#2563eb] px-3.5 py-2 text-xs font-semibold text-white">
          검수
        </span>
      </button>
    </li>
  );
}
