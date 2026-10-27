import { useCallback, useEffect, useRef, useState } from 'react';
import { useApiClient } from '../../core/data/ApiClientProvider';
import { errorMessage } from '../../core/data/errorMessage';
import { cn } from '../../core/design/cn';
import { useHumanKeys, useScanner } from '../../core/hardware/scan/useScanner';
import { isUncertainWrite, recordArrival } from '../../domains/customer-returns/api';
import {
  arrivalItems,
  hasPriorArrival,
  scanIntoParcel,
  setParcelCount,
  type ParcelCounts,
} from '../../domains/customer-returns/parcel';
import type { ReturnView } from '../../domains/customer-returns/types';
import { useDigitCommands, useStationActions } from '../ActionRegistry';
import type { StationAction } from '../actions';
import { useFeedback } from '../feedback/FeedbackProvider';
import { BigPanel, WorkGrid, type BigPanelContent } from '../outbound/panels';
import { RETURNS_ACTIONS } from './returnsActions';
import type { ReturnsNotice } from './returnsTypes';

type ArrivalBody = Parameters<typeof recordArrival>[2];

/** «한 번 더 눌러 확정» 대기 — F10 이미 받은 소포가 있는 반품, Esc 센 수량 버리기 */
type Armed = 'send' | 'discard' | null;

const UNCERTAIN_MESSAGE = '결과를 확인하지 못했어요 — F10 다시 보내기';
const CARD = 'rounded-[10px] border border-[#D5D8DE] bg-white';
const TH = 'border-b border-[#D5D8DE] bg-[#F6F7F8] px-4 py-2.5 text-left text-[13px] font-semibold text-[#535968]';

/**
 * 소포 세기(N5·N6) — 소포 하나를 세어 F10 으로 도착을 확정한다. 반품을 열 때마다 새로 마운트되고(부모의 key),
 * 소포 키는 그때 한 번 만든다. 결과를 모르는 도착(응답 없음·5xx)은 수량을 잠그고 F10 이 같은 키·같은 본문을 다시 보낸다 —
 * 수량을 바꾸면 같은 키·다른 수량이라 서버가 409 로 거절한다. 거절(4xx)은 상세를 다시 읽어 그 단계로 간다(N10).
 */
export function ParcelWork({
  view,
  warehouseId,
  open,
  onArrived,
  toList,
  onActivity,
}: {
  view: ReturnView;
  warehouseId: string;
  /** 상세를 다시 읽어 단계대로 연다 — notice 는 다음 화면 위 한 줄 */
  open(id: string, notice?: ReturnsNotice): Promise<void>;
  /** 도착이 반영됐다 — 부모가 응답 뷰로 단계를 다시 판정한다(N8) */
  onArrived(view: ReturnView): void;
  toList(): void;
  /** 작업자가 새로 무언가 했다 — 위 안내를 지운다 */
  onActivity(): void;
}) {
  const api = useApiClient();
  const { signal } = useFeedback();
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [counts, setCounts] = useState<ParcelCounts>(() => new Map());
  // 한 렌더 안에 스캔이 둘 와도 앞 스캔이 센 것을 보게 — 판정은 늘 이 값으로
  const countsRef = useRef(counts);
  const [selected, setSelected] = useState(0);
  // 줄을 고른(찍은) 뒤 첫 숫자는 덮어쓴다, 그다음부터 이어 친다
  const [fresh, setFresh] = useState(true);
  const [armed, setArmed] = useState<Armed>(null);
  // 결과를 모르는 도착 — 다음 F10 이 이것을 그대로 다시 보낸다
  const [pending, setPending] = useState<ArrivalBody | null>(null);
  const [busy, setBusy] = useState(false);
  // 보내는 중 — 렌더 전에 F10 이 두 번 와도(같은 낡은 run) 한 번만 보내게. busy 는 다음 렌더에야 보인다
  const inFlight = useRef(false);
  const [alert, setAlert] = useState<{ message: string; detail?: string } | null>(null);

  const rows = view.lines.flatMap((line) => line.items.map((item) => ({ line, item })));
  const cursor = Math.min(selected, Math.max(rows.length - 1, 0));
  const total = [...counts.values()].reduce((sum, q) => sum + q, 0);
  const prior = hasPriorArrival(view);
  const locked = busy || pending !== null;

  const commit = (next: ParcelCounts) => {
    countsRef.current = next;
    setCounts(next);
  };

  /** 작업자의 입력 — 앞 안내·무장을 풀고, 잠겼으면 오류음만 */
  const touch = (): boolean => {
    onActivity();
    setArmed(null);
    if (!locked && !inFlight.current) return true;
    signal('error');
    return false;
  };

  const onScan = (code: string) => {
    if (!touch()) return;
    const result = scanIntoParcel(view, countsRef.current, code);
    if (result.kind === 'counted') {
      commit(result.counts);
      setSelected(rows.findIndex((row) => row.item.id === result.itemId));
      setFresh(true);
      setAlert(null);
      signal('success');
      return;
    }
    setAlert({ message: result.kind === 'full' ? '더 받을 수 없어요' : '이 반품에 없는 상품이에요', detail: code });
    signal('error');
  };
  const scanRef = useRef(onScan);
  scanRef.current = onScan;
  useScanner(useCallback((event: { code: string }) => scanRef.current(event.code), []));

  /** 선택 줄의 «이번 소포» 를 바꾼다 — 상한(기대 − 이미 도착)을 넘으면 오류음·그대로 */
  const edit = (next: (current: number) => number) => {
    if (!touch()) return;
    const row = rows[cursor];
    if (!row) return;
    const result = setParcelCount(view, countsRef.current, row.item.id, next(countsRef.current.get(row.item.id) ?? 0));
    if (result.kind === 'over') {
      signal('error');
      return;
    }
    commit(result.counts);
    setFresh(false);
    setAlert(null);
  };
  const typeDigit = (digit: number) => edit((current) => (fresh ? digit : current * 10 + digit));
  const typeRef = useRef(typeDigit);
  typeRef.current = typeDigit;
  useDigitCommands(useCallback((digit: number) => typeRef.current(digit), []));
  useHumanKeys((key: string) => {
    if (/^\d$/.test(key)) typeDigit(Number(key));
    else if (key === 'Backspace') edit((current) => Math.floor(current / 10));
    else if (key === 'ArrowUp' || key === 'ArrowDown') {
      onActivity();
      setArmed(null);
      setSelected(Math.max(0, Math.min(rows.length - 1, cursor + (key === 'ArrowUp' ? -1 : 1))));
      setFresh(true);
    }
  });

  const send = async (body: ArrivalBody) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      onArrived(await recordArrival(api, view.id, body));
    } catch (error) {
      if (isUncertainWrite(error)) {
        setPending(body);
        signal('error');
      } else {
        setPending(null);
        await open(view.id, { text: errorMessage(error), tone: 'error' });
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const confirm = () => {
    onActivity();
    if (inFlight.current) return;
    if (pending) {
      // Esc 의 «버리기» 대기가 다시 보내기를 넘어 살아남지 않게
      setArmed(null);
      void send(pending);
      return;
    }
    // N6 — 결과를 모른 채 다시 켠 작업자가 같은 소포를 두 번 세지 않게
    if (prior && armed !== 'send') {
      setArmed('send');
      return;
    }
    setArmed(null);
    void send({ warehouseId, items: arrivalItems(countsRef.current), idempotencyKey });
  };

  const back = () => {
    if (armed === 'send') setArmed(null);
    else if (armed === 'discard' || (total === 0 && pending === null)) toList();
    else setArmed('discard');
  };

  const actions: StationAction[] = [
    {
      ...RETURNS_ACTIONS.confirmArrival,
      label: pending ? '다시 보내기' : RETURNS_ACTIONS.confirmArrival.label,
      enabled: !busy && (pending !== null || total > 0),
      run: confirm,
    },
    {
      ...RETURNS_ACTIONS.back,
      label: armed === 'send' ? '취소' : RETURNS_ACTIONS.back.label,
      enabled: !busy,
      run: back,
    },
  ];
  useStationActions(actions);

  const big: BigPanelContent | null =
    armed === 'send'
      ? { kind: 'notice', title: '새 소포면 F10 한 번 더' }
      : armed === 'discard'
        ? { kind: 'notice', title: '한 번 더 누르면 센 수량을 버려요' }
        : pending
          ? { kind: 'alert', message: UNCERTAIN_MESSAGE }
          : alert
            ? { kind: 'alert', ...alert }
            : null;

  return (
    <section aria-label="소포 세기" className="h-full min-h-0">
      <WorkGrid
        left={
          <>
            <div className={cn(CARD, 'flex shrink-0 flex-col gap-2.5 p-[18px]')}>
              <h2 className="font-mono text-[30px] font-semibold">{view.order.orderNo}</h2>
              {prior ? <p className="text-base font-semibold text-[#7A4B00]">이미 받은 소포가 있어요</p> : null}
            </div>
            {big ? <BigPanel content={big} /> : <CountPanel total={total} />}
          </>
        }
        right={
          <div className={cn(CARD, 'min-h-0 flex-1 overflow-auto')}>
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={TH}>상품</th>
                  <th className={cn(TH, 'w-[120px] text-right')}>남은 수량</th>
                  <th className={cn(TH, 'w-[120px] text-right')}>이번 소포</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ line, item }, index) => (
                  <ParcelRow
                    key={item.id}
                    itemId={item.id}
                    name={item.skuName}
                    // 세트 구성품이면 어느 상품의 것인지
                    product={line.productName !== item.skuName ? line.productName : null}
                    remaining={item.expectedQty - item.arrivedQty}
                    parcel={counts.get(item.id) ?? 0}
                    selected={index === cursor}
                  />
                ))}
              </tbody>
            </table>
          </div>
        }
      />
    </section>
  );
}

function CountPanel({ total }: { total: number }) {
  return (
    <div
      role="status"
      aria-label="이번 소포"
      className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 rounded-[10px] border border-[#D5D8DE] bg-white p-6 text-center"
    >
      <div className="text-[30px] font-bold text-[#1D5BD8]">이번 소포</div>
      <div className="font-mono text-[120px] font-semibold leading-none">{total}</div>
    </div>
  );
}

function ParcelRow({
  itemId,
  name,
  product,
  remaining,
  parcel,
  selected,
}: {
  itemId: string;
  name: string;
  product: string | null;
  remaining: number;
  parcel: number;
  selected: boolean;
}) {
  const ref = useRef<HTMLTableRowElement>(null);
  // ↑↓·스캔으로 고른 줄이 화면 밖이면 따라간다(jsdom 엔 scrollIntoView 가 없다)
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView?.({ block: 'nearest' });
  }, [selected]);
  return (
    <tr
      ref={ref}
      data-item-id={itemId}
      aria-selected={selected}
      className={cn(
        'h-[72px] border-b border-[#E4E6EA] text-[17px]',
        remaining === 0 && 'text-[#6B717D]',
        selected && 'bg-[#FFF1C7]'
      )}
    >
      <td className="px-4">
        <div className="font-semibold">{name}</div>
        {product ? <div className="text-sm text-[#535968]">{product}</div> : null}
      </td>
      <td data-col="remaining" className="px-4 text-right font-mono">
        {remaining}
      </td>
      <td data-col="parcel" className={cn('px-4 text-right font-mono text-2xl font-semibold', parcel === 0 && 'text-[#A3A9B4]')}>
        {parcel}
      </td>
    </tr>
  );
}
