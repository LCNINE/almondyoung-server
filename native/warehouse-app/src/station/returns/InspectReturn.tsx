import { useCallback, useEffect, useRef, useState } from 'react';
import { useApiClient } from '../../core/data/ApiClientProvider';
import { errorMessage } from '../../core/data/errorMessage';
import { cn } from '../../core/design/cn';
import { useHumanKeys, useScanner } from '../../core/hardware/scan/useScanner';
import { isUncertainWrite, recordInspection } from '../../domains/customer-returns/api';
import {
  acceptedOf,
  heldTotal,
  inspectionItems,
  setInspectionCell,
  type InspectionColumn,
  type InspectionDraft,
} from '../../domains/customer-returns/inspection';
import type { ReturnView } from '../../domains/customer-returns/types';
import { useDigitCommands, useStationActions } from '../ActionRegistry';
import type { StationAction } from '../actions';
import { useFeedback } from '../feedback/FeedbackProvider';
import { BigPanel, WorkGrid, type BigPanelContent } from '../outbound/panels';
import { ReturnReasonBand } from './ReturnReasonBand';
import { RETURNS_ACTIONS } from './returnsActions';
import type { ReturnsNotice } from './returnsTypes';

type InspectionBody = Parameters<typeof recordInspection>[2];

/** «한 번 더 눌러» 대기 — F10 검수 확정, Esc 입력 버리기 */
type Armed = 'confirm' | 'discard' | null;

const UNCERTAIN_MESSAGE = '결과를 확인하지 못했어요 — F10 다시 보내기';
const COLUMN_LABEL: Record<InspectionColumn, string> = { rejected: '불량', held: '보류' };
const CARD = 'rounded-[10px] border border-[#D5D8DE] bg-white';
const TH = 'border-b border-[#D5D8DE] bg-[#F6F7F8] px-4 py-2.5 text-left text-[13px] font-semibold text-[#535968]';

/**
 * 검수(N7) — 도착한 것을 불량·보류로 나누고 F10 두 번으로 확정한다(되돌릴 수 없다: 원장 이동 + 환불 요청 또는 CS 확인).
 * 양품은 도착 − 불량 − 보류로 따라 바뀐다(입력 칸이 아니다). 반품을 열 때마다 새로 마운트된다(부모의 key).
 * 결과를 모르는 검수(응답 없음·5xx)는 칸을 잠그고 F10 이 같은 본문을 다시 보낸다 — 같은 결과면 서버가 그대로 돌려준다.
 * 거절(4xx)은 상세를 다시 읽어 그 단계로 간다(N10) — 취소·이미 검수된 반품이면 목록으로.
 */
export function InspectReturn({
  view,
  open,
  toList,
  onActivity,
}: {
  view: ReturnView;
  /** 상세를 다시 읽어 단계대로 연다 — notice 는 다음 화면 위 한 줄 */
  open(id: string, notice?: ReturnsNotice): Promise<void>;
  toList(): void;
  /** 작업자가 새로 무언가 했다 — 위 안내를 지운다 */
  onActivity(): void;
}) {
  const api = useApiClient();
  const { signal } = useFeedback();
  const [draft, setDraft] = useState<InspectionDraft>(() => new Map());
  // 한 렌더 안에 숫자가 둘 와도 앞 숫자가 바꾼 것을 보게 — 판정은 늘 이 값으로
  const draftRef = useRef(draft);
  const [selected, setSelected] = useState(0);
  const [column, setColumn] = useState<InspectionColumn>('rejected');
  // 칸을 고른 뒤 첫 숫자는 덮어쓴다, 그다음부터 이어 친다
  const [fresh, setFresh] = useState(true);
  // 첫 누름 — 칸을 바꾸면(입력·이동·스캔) 풀린다
  const [armed, setArmed] = useState<Armed>(null);
  // 결과를 모르는 검수 — 다음 F10 이 이것을 그대로 다시 보낸다
  const [pending, setPending] = useState<InspectionBody | null>(null);
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<{ message: string; detail?: string } | null>(null);
  // 보내는 중 — 렌더 전에 F10 이 두 번 와도(같은 낡은 run) 한 번만 보내게. busy 는 다음 렌더에야 보인다
  const inFlight = useRef(false);

  // 도착 0 인 항목은 나눌 것이 없다 — 그리지 않는다(본문엔 0/0/0 으로 실린다)
  const rows = view.lines.flatMap((line) => line.items.filter((item) => item.arrivedQty > 0).map((item) => ({ line, item })));
  const cursor = Math.min(selected, Math.max(rows.length - 1, 0));
  const locked = busy || pending !== null;
  const touched = [...draft.values()].some((c) => c.rejected > 0 || c.held > 0);

  /** 작업자의 입력 — 앞 안내·첫 누름을 풀고, 잠겼으면 오류음만 */
  const touch = (): boolean => {
    onActivity();
    setArmed(null);
    if (!locked && !inFlight.current) return true;
    signal('error');
    return false;
  };

  /** 선택 칸(불량 또는 보류)을 바꾼다 — 불량 + 보류가 도착을 넘으면 오류음·그대로 */
  const edit = (next: (current: number) => number) => {
    if (!touch()) return;
    const row = rows[cursor];
    if (!row) return;
    const current = draftRef.current.get(row.item.id)?.[column] ?? 0;
    const result = setInspectionCell(view, draftRef.current, row.item.id, column, next(current));
    if (result.kind === 'over') {
      signal('error');
      return;
    }
    draftRef.current = result.draft;
    setDraft(result.draft);
    setFresh(false);
    setAlert(null);
  };
  const typeDigit = (digit: number) => edit((current) => (fresh ? digit : current * 10 + digit));
  const typeRef = useRef(typeDigit);
  typeRef.current = typeDigit;
  useDigitCommands(useCallback((digit: number) => typeRef.current(digit), []));

  const moveRow = (delta: number) => {
    if (!touch()) return;
    setSelected(Math.max(0, Math.min(rows.length - 1, cursor + delta)));
    setFresh(true);
    setAlert(null);
  };
  const moveColumn = (next: InspectionColumn) => {
    if (!touch()) return;
    setColumn(next);
    setFresh(true);
    setAlert(null);
  };

  /** 상품 스캔 = 그 상품의 첫 줄을 고른다(스테이션 §8 — 상품 칸은 스캔도 받는다). 도착 0 인 항목은 줄이 없어 없는 상품이다 */
  const onScan = (code: string) => {
    if (!touch()) return;
    const index = rows.findIndex(({ item }) => item.barcodes.includes(code));
    if (index < 0) {
      setAlert({ message: '이 반품에 없는 상품이에요', detail: code });
      signal('error');
      return;
    }
    setSelected(index);
    setFresh(true);
    setAlert(null);
    signal('success');
  };
  const scanRef = useRef(onScan);
  scanRef.current = onScan;
  useScanner(useCallback((event: { code: string }) => scanRef.current(event.code), []));
  useHumanKeys((key: string) => {
    if (/^\d$/.test(key)) typeDigit(Number(key));
    else if (key === 'Backspace') edit((current) => Math.floor(current / 10));
    else if (key === 'ArrowUp') moveRow(-1);
    else if (key === 'ArrowDown') moveRow(1);
    else if (key === 'ArrowLeft') moveColumn('rejected');
    else if (key === 'ArrowRight') moveColumn('held');
  });

  const send = async (body: InspectionBody) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      await recordInspection(api, view.id, body);
      signal('complete');
      toList();
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
      setArmed(null);
      void send(pending);
      return;
    }
    if (armed !== 'confirm') {
      setArmed('confirm');
      return;
    }
    setArmed(null);
    void send({ items: inspectionItems(view, draftRef.current) });
  };

  /** Esc — 첫 누름이면 그것만 푼다. 입력했거나 결과를 모르면 한 번 더 눌러야 버린다(소포 세기와 같다) */
  const back = () => {
    onActivity();
    if (armed === 'confirm') setArmed(null);
    else if (armed === 'discard' || (!touched && pending === null)) toList();
    else setArmed('discard');
  };

  const actions: StationAction[] = [
    {
      ...RETURNS_ACTIONS.confirmInspection,
      label: pending ? '다시 보내기' : RETURNS_ACTIONS.confirmInspection.label,
      enabled: !busy,
      run: confirm,
    },
    {
      ...RETURNS_ACTIONS.back,
      label: armed === 'confirm' ? '취소' : RETURNS_ACTIONS.back.label,
      enabled: !busy,
      run: back,
    },
  ];
  useStationActions(actions);

  const active = rows[cursor];
  const big: BigPanelContent | null =
    armed === 'confirm'
      ? {
          kind: 'notice',
          title: heldTotal(draft) > 0 ? '한 번 더 누르면 CS 확인으로 넘겨요' : '한 번 더 누르면 환불을 요청해요',
        }
      : armed === 'discard'
        ? { kind: 'notice', title: '한 번 더 누르면 입력을 버려요' }
        : pending
          ? { kind: 'alert', message: UNCERTAIN_MESSAGE }
          : alert
            ? { kind: 'alert', ...alert }
            : null;

  return (
    <section aria-label="검수" className="h-full min-h-0">
      <WorkGrid
        left={
          <>
            <div className={cn(CARD, 'flex shrink-0 flex-col gap-2.5 p-[18px]')}>
              <h2 className="font-mono text-[30px] font-semibold">{view.order.orderNo}</h2>
              <ReturnReasonBand view={view} />
            </div>
            {big ? (
              <BigPanel content={big} />
            ) : active ? (
              <CellPanel label={COLUMN_LABEL[column]} value={draft.get(active.item.id)?.[column] ?? 0} />
            ) : null}
          </>
        }
        right={
          <div className={cn(CARD, 'min-h-0 flex-1 overflow-auto')}>
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={TH}>상품</th>
                  <th className={cn(TH, 'w-[96px] text-right')}>도착</th>
                  <th className={cn(TH, 'w-[96px] text-right')}>양품</th>
                  <th className={cn(TH, 'w-[110px] text-right')}>불량</th>
                  <th className={cn(TH, 'w-[110px] text-right')}>보류</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ line, item }, index) => {
                  const cell = draft.get(item.id) ?? { rejected: 0, held: 0 };
                  return (
                    <InspectRow
                      key={item.id}
                      itemId={item.id}
                      name={item.skuName}
                      // 세트 구성품이면 어느 상품의 것인지
                      product={line.productName !== item.skuName ? line.productName : null}
                      arrived={item.arrivedQty}
                      accepted={acceptedOf(item, draft)}
                      rejected={cell.rejected}
                      held={cell.held}
                      activeColumn={index === cursor ? column : null}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        }
      />
    </section>
  );
}

/** 왼쪽 큰 칸 — 지금 숫자가 들어갈 칸과 그 값 */
function CellPanel({ label, value }: { label: string; value: number }) {
  return (
    <div
      role="status"
      aria-label={label}
      className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 rounded-[10px] border border-[#D5D8DE] bg-white p-6 text-center"
    >
      <div className="text-[30px] font-bold text-[#1D5BD8]">{label}</div>
      <div className="font-mono text-[120px] font-semibold leading-none">{value}</div>
    </div>
  );
}

function InspectRow({
  itemId,
  name,
  product,
  arrived,
  accepted,
  rejected,
  held,
  activeColumn,
}: {
  itemId: string;
  name: string;
  product: string | null;
  arrived: number;
  accepted: number;
  rejected: number;
  held: number;
  /** 선택 줄이면 숫자가 들어갈 칸 */
  activeColumn: InspectionColumn | null;
}) {
  const ref = useRef<HTMLTableRowElement>(null);
  const selected = activeColumn !== null;
  // ↑↓ 로 고른 줄이 화면 밖이면 따라간다(jsdom 엔 scrollIntoView 가 없다)
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView?.({ block: 'nearest' });
  }, [selected]);
  const input = (col: InspectionColumn, value: number) => (
    <td
      data-col={col}
      data-active={activeColumn === col ? 'true' : undefined}
      className={cn(
        'px-4 text-right font-mono text-2xl font-semibold',
        value === 0 && 'text-[#A3A9B4]',
        activeColumn === col && 'outline outline-2 -outline-offset-2 outline-[#1D5BD8]'
      )}
    >
      {value}
    </td>
  );
  return (
    <tr
      ref={ref}
      data-item-id={itemId}
      aria-selected={selected}
      className={cn('h-[72px] border-b border-[#E4E6EA] text-[17px]', selected && 'bg-[#FFF1C7]')}
    >
      <td className="px-4">
        <div className="font-semibold">{name}</div>
        {product ? <div className="text-sm text-[#535968]">{product}</div> : null}
      </td>
      <td data-col="arrived" className="px-4 text-right font-mono">
        {arrived}
      </td>
      <td data-col="accepted" className="px-4 text-right font-mono">
        {accepted}
      </td>
      {input('rejected', rejected)}
      {input('held', held)}
    </tr>
  );
}
