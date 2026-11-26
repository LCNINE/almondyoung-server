import { useState, type ReactNode } from 'react';
import { Check, CircleHelp, Package, Printer, ScanLine, X } from 'lucide-react';
import { Button } from '../../core/design/Button';
import { cn } from '../../core/design/cn';
import { SCAN_STORAGE_MESSAGE } from '../../core/hardware/scan/useWorkScanQueue';
import { formatTrackingNo, splitShareLines, type InspectionRow } from '../../domains/outbound/inspection';
import type { SplitShare } from '../../domains/outbound/types';
import type { LabelItemChange } from '../../domains/outbound/waybillLabel';
import { Kbd } from '../Kbd';
import { bigTextPx, type LastBox } from './model';
import { clockOf, type RecentEntry, type RecentKind } from './recent';
import { UNCERTAIN_SCAN_MESSAGE } from './useInspectionBox';
import type { CancelWaitingLine } from '../../domains/outbound/cancelWaiting';

const CARD = 'rounded-xl border border-[#e4e4e7] bg-white';

/** 출고 검수 작업 영역 — 왼쪽 송장 카드, 오른쪽 스캔칸·표·최근. 셸 <main> 이 이미 여백을 준다 */
export function WorkGrid({ left, right, intake }: { left: ReactNode; right: ReactNode; intake?: 'open' | 'blocked' }) {
  return (
    <div
      data-intake={intake}
      className="grid h-full min-h-0 grid-cols-[minmax(290px,.76fr)_minmax(480px,1.85fr)] gap-[22px] max-[700px]:flex max-[700px]:flex-col"
    >
      <section className="flex min-h-0 min-w-0 flex-col gap-4">{left}</section>
      <section className="flex min-h-0 min-w-0 flex-col gap-4">{right}</section>
    </div>
  );
}

const CARRIER_NAMES: Record<string, string> = { HANJIN: '한진택배' };

export function carrierName(code: string | null | undefined): string {
  if (!code) return '';

  return CARRIER_NAMES[code] ?? code;
}

interface ShipmentFacts {
  trackingNo: string;
  recipient: string;
  carrier?: string | null;
  ownerName?: string | null;
  split?: SplitShare | null;
}

/** 송장 카드의 윗부분 — 송장번호·받는 분·택배사, 화주와 나눈 상자 */
function ShipmentSummary({ trackingNo, recipient, carrier, ownerName, split }: ShipmentFacts) {
  const share = splitShareLines(split);
  const carrierLabel = carrierName(carrier);

  return (
    <div className="flex flex-col">
      <div className="text-xs text-[#71717a]">현재 검수 중인 송장</div>
      <h2 className="mt-3 text-[25px] leading-tight font-[650] tracking-[-0.7px] tabular-nums">{formatTrackingNo(trackingNo)}</h2>
      <div className="mt-2.5 text-xs text-[#71717a]">
        <span>{recipient}</span>
        {carrierLabel ? (
          <>
            <span className="mx-[5px] text-[#a1a1aa]">·</span>
            <span>{carrierLabel}</span>
          </>
        ) : null}
      </div>
      {ownerName ? (
        <div className="mt-3 self-start rounded-[5px] bg-[#27272a] px-2.5 py-1.5 text-[13px] font-semibold text-white">
          3PL · {ownerName}
        </div>
      ) : null}
      {share ? (
        <div aria-label="나눈 상자" className="mt-3 rounded-lg bg-[#eff6ff] px-3 py-2 text-[#2563eb]">
          <div className="text-sm font-semibold">{share.title}</div>
          <div className="text-xs">{share.detail}</div>
        </div>
      ) : null}
    </div>
  );
}

export function BoxCard(props: ShipmentFacts) {
  return (
    <div className={cn(CARD, 'shrink-0 p-[22px]')}>
      <ShipmentSummary {...props} />
    </div>
  );
}

export type SummaryMiddle =
  | { kind: 'progress'; scanned: number; ordered: number; kinds: number }
  | { kind: 'quantity'; value: string }
  | { kind: 'armed'; keyLabel: string; label: string }
  | { kind: 'cancelWaiting'; lines: CancelWaitingLine[]; whole: boolean };

/** 송장 카드 아래의 오스캔 문장 — 거절 사유, 무엇을 찍었는지(상품 이름·바코드), 수량이 오르지 않았는지 */
export interface ScanFeedback {
  message: string;
  detail?: string;
  item?: string;
  /** 서버가 확정 거절해 수량이 오르지 않았다 */
  unapplied?: boolean;
}

/** 검수 중 왼쪽 송장 카드 — 송장·검수 수량·막대, 맨 아래에 오스캔 문장. 오스캔이면 테두리가 붉다 */
export function InspectionSummary({
  middle,
  feedback,
  ...facts
}: ShipmentFacts & { middle: SummaryMiddle; feedback: ScanFeedback | null }) {
  return (
    <section
      data-scan-error={feedback ? 'true' : undefined}
      className={cn(
        CARD,
        'flex min-h-0 flex-1 flex-col overflow-auto p-7 max-[700px]:min-h-[300px] max-[700px]:p-[23px]',
        feedback && 'border-[#d58c85]'
      )}
    >
      <ShipmentSummary {...facts} />
      <div className="my-auto py-7 max-[700px]:py-[22px]">
        <SummaryBlock middle={middle} />
      </div>
      <SummaryFoot feedback={feedback} />
    </section>
  );
}

const HUGE = 'text-[86px] leading-[1.1] font-[650] tracking-[-4px] whitespace-nowrap tabular-nums max-[700px]:text-[68px]';

function SummaryBlock({ middle }: { middle: SummaryMiddle }) {
  switch (middle.kind) {
    case 'progress': {
      const ratio = middle.ordered > 0 ? Math.min(1, middle.scanned / middle.ordered) : 0;
      const left = Math.max(0, middle.ordered - middle.scanned);

      return (
        <div role="status" aria-label="진행">
          <div className="mb-[13px] text-xs text-[#71717a]">검수 수량</div>
          <div className={cn(HUGE, 'text-[#27272a]')}>
            {middle.scanned}
            <span className="ml-1.5 text-[32px] font-normal tracking-[-1px] text-[#a1a1aa]">
              {` / ${middle.ordered}`}
              <small className="ml-1 text-[13px] tracking-normal">개</small>
            </span>
          </div>
          <div className="mt-6 h-[5px] overflow-hidden rounded-md bg-[#ededee]">
            <div className="h-full rounded-md bg-[#52525b] transition-[width] duration-[250ms]" style={{ width: `${ratio * 100}%` }} />
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-[#71717a]">
            <span>
              전체 {middle.kinds}종 · {middle.ordered}개
            </span>
            <strong className="font-semibold text-[#3f3f46]">{left}개 남음</strong>
          </div>
        </div>
      );
    }
    case 'quantity':
      return (
        <div role="status" aria-label="수량">
          <div className="mb-[13px] text-xs font-semibold text-[#2563eb]">수량</div>
          <div className={cn(HUGE, 'text-[#2563eb]')}>{middle.value || '_'}</div>
        </div>
      );
    case 'armed':
      return (
        <div role="status" className="rounded-[10px] bg-[#fff1d9] p-5 text-[#9a681c]">
          <div className="text-[22px] leading-snug font-bold break-keep">{middle.label}</div>
          <div className="mt-3 flex items-center gap-2 text-sm font-semibold">
            <Kbd tone="outline" className="opacity-100">
              {middle.keyLabel}
            </Kbd>
            한 번 더
          </div>
        </div>
      );
    case 'cancelWaiting':
      return (
        <div role="status" aria-label="취소 대기" className="rounded-[10px] bg-[#fff1d9] p-5 text-[#9a681c]">
          <div className="text-lg font-bold">{middle.whole ? '주문이 취소된 박스예요' : '주문 일부가 취소된 박스예요'}</div>
          {middle.lines.length ? (
            <ul className="mt-3 w-full list-none text-sm font-semibold">
              {middle.lines.map((line, index) => (
                <li key={`${line.name}-${index}`} className="flex justify-between gap-3">
                  <span className="min-w-0 truncate">{line.name}</span>
                  <span className="whitespace-nowrap tabular-nums">
                    {line.from} → {line.to}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="mt-3 text-sm">
            검수하지 말고 F11 을 두 번 눌러 박스를 빼 주세요. 담은 상품은 빼기 화면에서 되돌림 바구니에 넣어요.
          </div>
        </div>
      );
  }
}

function SummaryFoot({ feedback }: { feedback: ScanFeedback | null }) {
  const base = 'flex min-h-[85px] shrink-0 items-center gap-2 border-t border-[#e4e4e7] pt-4';

  if (!feedback) {
    return (
      <div className={cn(base, 'text-[11px] text-[#71717a]')}>
        <ScanLine className="h-4 w-4" aria-hidden />
        <span>상품을 모두 확인하면 자동 출고</span>
      </div>
    );
  }

  const rejected = [feedback.item, feedback.detail].filter(Boolean).join(' ');

  return (
    <div role="alert" aria-atomic="true" className={cn(base, 'text-[#b42318]')}>
      <div className="min-w-0">
        <strong className="block text-sm leading-normal font-[650] tracking-[-0.2px]">{feedback.message}</strong>
        {rejected ? <span className="mt-1 block text-xs leading-normal [overflow-wrap:anywhere]">{rejected}</span> : null}
        {feedback.unapplied ? (
          <small className="mt-[3px] block text-[11px] leading-[1.6]">수량 미반영 · 다음 상품을 스캔해 주세요.</small>
        ) : null}
      </div>
    </div>
  );
}

/** 스캔칸 — 스캐너는 화면 어디서든 받으므로 입력칸이 아니라 안내다. 확인 버튼이 없다 */
export function ScanField({ placeholder, children }: { placeholder: string; children?: ReactNode }) {
  return (
    <div className="flex w-full shrink-0 items-center gap-2 rounded-[10px] border border-[#e4e4e7] bg-white px-[15px] py-3 text-left">
      <ScanLine className="h-[23px] w-[23px] shrink-0 text-[#2563eb]" aria-hidden />
      {children ?? <span className="min-w-0 flex-1 p-[5px] text-sm text-[#a1a1aa]">{placeholder}</span>}
    </div>
  );
}

export type BigPanelContent =
  | { kind: 'alert'; message: string; detail?: string; item?: string }
  | { kind: 'notice'; title: string; message?: string }
  | { kind: 'quantity'; value: string };

/** 검수 밖 화면(새 송장·뺄 상품·빠진 박스·송장 대기, 입고·반품 스테이션)의 큰 칸 — 오류·안내·수량 하나 */
export function BigPanel({ content }: { content: BigPanelContent }) {
  const base = 'flex min-h-0 flex-1 flex-col items-center justify-center gap-3 rounded-xl p-7 text-center';

  switch (content.kind) {
    case 'alert':
      return (
        <div role="alert" className={cn(base, 'border-2 border-[#aa4037] bg-[#fff4f1] text-[#aa4037]')}>
          <div className="text-2xl font-bold break-keep">{content.message}</div>
          {content.item ? <div className="text-lg font-semibold text-[#27272a]">{content.item}</div> : null}
          {content.detail ? <div className="text-base font-semibold tabular-nums">{content.detail}</div> : null}
        </div>
      );
    case 'notice':
      return (
        <div role="status" className={cn(base, 'border border-[#e4e4e7] bg-white')}>
          <div className="text-[28px] font-bold tracking-[-0.8px]">{content.title}</div>
          {content.message ? <div className="text-sm text-[#71717a]">{content.message}</div> : null}
        </div>
      );
    case 'quantity':
      return (
        <div role="status" aria-label="수량" className={cn(base, 'border-2 border-[#2563eb] bg-white')}>
          <div className="text-sm font-semibold text-[#2563eb]">수량</div>
          <div className={cn(HUGE, 'text-[#2563eb]')} style={{ fontSize: Math.min(86, bigTextPx(content.value || '_')) }}>
            {content.value || '_'}
          </div>
        </div>
      );
  }
}

const TH = 'bg-[#fafafa] px-5 py-3 text-left text-[11px] font-medium whitespace-nowrap text-[#71717a]';
const TD = 'border-t border-[#e4e4e7] px-5 py-4 align-middle';

/** 위치 하나면 코드만, 나뉜 줄은 위치마다 한 줄 + 위치별 수량 — 코드 중간에서 꺾이지 않게 */
function LocationCell({ locations }: { locations: InspectionRow['locations'] }) {
  if (locations.length === 0) return <>—</>;
  if (locations.length === 1) return <span className="whitespace-nowrap">{locations[0].code}</span>;

  return (
    <ul className="list-none">
      {locations.map((location) => (
        <li key={location.code} className="whitespace-nowrap">
          {location.code} ×{location.qty}
        </li>
      ))}
    </ul>
  );
}

function PanelHead({ title, meta }: { title: string; meta?: string }) {
  return (
    <div className="flex shrink-0 items-center justify-between gap-2.5 border-b border-[#e4e4e7] px-[22px] py-[19px]">
      <h3 className="text-[15px] font-semibold">{title}</h3>
      {meta ? <small className="text-xs text-[#71717a]">{meta}</small> : null}
    </div>
  );
}

/** 이 상자에 담을 상품 `로케이션 | 상품 / 옵션 | 검수 / 주문 | 상태` — 다 찬 줄은 흐리게, 위치는 보여 주기만 */
export function LineTable({ rows, currentLineId }: { rows: readonly InspectionRow[]; currentLineId: string | null }) {
  const ordered = rows.reduce((sum, row) => sum + row.ordered, 0);

  return (
    <section className={cn(CARD, 'flex min-h-0 flex-1 flex-col overflow-hidden')}>
      <PanelHead title="이 상자에 담을 상품" meta={`${rows.length}종 · ${ordered}개`} />
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className={cn(TH, 'max-[700px]:hidden')}>로케이션</th>
              <th className={TH}>상품 / 옵션</th>
              <th className={cn(TH, 'text-right')}>검수 / 주문</th>
              <th className={TH}>상태</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const current = !row.done && row.shipmentLineId === currentLineId;

              return (
                <tr
                  key={row.shipmentLineId}
                  data-state={row.done ? 'done' : current ? 'current' : 'todo'}
                  className={cn(row.done && 'bg-[#fcfcfc] text-[#8c8c95]')}
                >
                  <td className={cn(TD, 'text-xs whitespace-nowrap tabular-nums max-[700px]:hidden')}>
                    <LocationCell locations={row.locations} />
                  </td>
                  <td className={TD}>
                    <strong className="block text-sm leading-normal font-semibold">{row.name}</strong>
                  </td>
                  <td className={cn(TD, 'text-right text-xl font-bold whitespace-nowrap tabular-nums')}>
                    {row.scanned} <span className="text-sm font-normal text-[#71717a]">/ {row.ordered}</span>
                  </td>
                  <td className={cn(TD, 'w-10')}>
                    {row.done ? (
                      <Check className="h-5 w-5 text-[#2563eb]" aria-label="완료" />
                    ) : (
                      <span
                        className={cn(
                          'inline-flex items-center rounded-[5px] px-2 py-[5px] text-xs font-semibold whitespace-nowrap',
                          row.scanned > 0 ? 'bg-[#eff6ff] text-[#2563eb]' : 'bg-[#eff1f2] text-[#68706d]'
                        )}
                      >
                        {row.scanned > 0 ? '진행' : '대기'}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** 송장이 바뀐 줄 `위치 | 상품 | 송장 → 지금`(목업 ④) */
export function ChangeTable({ changes }: { changes: readonly LabelItemChange[] }) {
  return (
    <section className={cn(CARD, 'flex min-h-0 flex-1 flex-col overflow-hidden')}>
      <PanelHead title="송장이 바뀐 상품" />
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className={TH}>로케이션</th>
              <th className={TH}>상품</th>
              <th className={cn(TH, 'text-right')}>송장 → 지금</th>
            </tr>
          </thead>
          <tbody>
            {changes.map((change) => (
              <tr key={`${change.locationCode}-${change.skuId}`}>
                <td className={cn(TD, 'text-xs whitespace-nowrap tabular-nums')}>{change.locationCode}</td>
                <td className={cn(TD, 'font-semibold')}>{change.name}</td>
                <td className={cn(TD, 'text-right text-lg tabular-nums')}>
                  <span className="text-[#71717a] line-through">{change.printedQty}</span> → <strong>{change.currentQty}</strong>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const RECENT_ICON: Record<RecentKind, typeof Check> = {
  waybill: ScanLine,
  scan: Check,
  shipped: Package,
  printed: Printer,
  error: X,
  check: CircleHelp,
};
const RECENT_TONE: Record<RecentKind, string> = {
  waybill: 'text-[#2563eb]',
  scan: 'text-[#2563eb]',
  shipped: 'text-[#2563eb]',
  printed: 'text-[#9a681c]',
  error: 'text-[#b42318]',
  check: 'text-[#9a681c]',
};

function recentText(entry: RecentEntry): string {
  if (entry.kind === 'shipped') return `${formatTrackingNo(entry.text)} 출고 완료`;
  if (entry.kind === 'printed') return `${formatTrackingNo(entry.text)} 새 송장 출력`;
  if (entry.kind === 'waybill') return formatTrackingNo(entry.text);
  if (entry.kind === 'check') return `${formatTrackingNo(entry.text)} 처리 여부 확인 중 — 아래 «확인할 일»`;

  return entry.text;
}

/** 최근 스캔 — 비었으면 그리지 않는다(U2) */
export function RecentList({ entries, grow = false }: { entries: readonly RecentEntry[]; grow?: boolean }) {
  if (entries.length === 0) return null;

  return (
    <ol
      aria-label="최근 스캔"
      className={cn(
        'list-none overflow-hidden rounded-[10px] border border-[#e4e4e7] bg-white px-[19px] py-1.5 text-xs text-[#71717a]',
        grow ? 'min-h-0 flex-1' : 'max-h-[172px] shrink-0'
      )}
    >
      {entries.map((entry) => {
        const Icon = RECENT_ICON[entry.kind];

        return (
          <li
            key={entry.id}
            className={cn(
              'grid h-10 grid-cols-[64px_26px_minmax(0,1fr)_auto] items-center border-b border-[#f0f0f1] last:border-b-0',
              entry.kind === 'error' && 'font-semibold text-[#b42318]'
            )}
          >
            <span className="tabular-nums">{clockOf(entry.at)}</span>
            <Icon className={cn('h-4 w-4', RECENT_TONE[entry.kind])} aria-hidden />
            <span className={cn('truncate', entry.kind !== 'error' && 'text-[#27272a]')}>{recentText(entry)}</span>
            <span className="font-semibold tabular-nums text-[#27272a]">{entry.qty ? `+${entry.qty}` : ''}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** 송장 대기 위의 직전 박스(목업 ①) — 출고 완료, 또는 보충 대기로 간 박스와 가져올 것 */
export function DoneBanner({ last }: { last: LastBox }) {
  if (last.kind === 'shipped')
    return (
      <div className="flex shrink-0 items-center gap-4 rounded-xl border border-[#c9dfcf] bg-[#e6f1e9] px-[22px] py-5">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#365d42] text-white">
          <Check className="h-6 w-6" aria-hidden />
        </span>
        <span className="text-[22px] font-[650] tracking-[-0.5px] tabular-nums">{formatTrackingNo(last.trackingNo)}</span>
        <span className="text-base font-semibold text-[#365d42]">출고 완료</span>
      </div>
    );

  return (
    <div className="shrink-0 overflow-hidden rounded-xl border border-[#e4e4e7] bg-white">
      <div className="flex h-10 items-center gap-2.5 bg-[#fff1d9] px-4 text-sm font-semibold text-[#9a681c]">
        <span className="tabular-nums">{formatTrackingNo(last.trackingNo)}</span> 보충 대기
      </div>
      <ul className="px-4 py-2 text-sm">
        {last.items.map((item) => (
          <li key={`${item.locationCode}-${item.name}`} className="py-1">
            <span className="font-semibold tabular-nums">[{item.locationCode}]</span> {item.name}{' '}
            <span className="font-semibold tabular-nums">×{item.qty}</span>
          </li>
        ))}
      </ul>
      {last.print.kind === 'failed' ? (
        <p role="alert" className="border-t border-[#e4e4e7] px-4 py-2 text-sm font-semibold text-[#b42318]">
          {last.print.message}
        </p>
      ) : null}
    </div>
  );
}

/** 송장 대기 화면이 보이는 지금 배치 — 남은 상자 = 출고 안 된 상자(빠진 상자는 세지 않는다). 남은 상자가 있을 때만 보인다 */
export interface WaitingBatch {
  code: string;
  name: string | null;
  done: number;
  total: number;
}

/** 송장 대기(목업 ①) — 직접 입력칸이 열리면 스캔칸 자리에 그린다 */
export function WaitingPrompt({ batch, children }: { batch?: WaitingBatch | null; children?: ReactNode }) {
  return (
    <div className={cn(CARD, 'flex min-h-0 flex-1 flex-col items-center justify-center gap-0 p-14 text-center max-[700px]:p-7')}>
      {batch ? <WaitingBatchLine batch={batch} /> : null}
      <ScanLine className="h-[72px] w-[72px] text-[#2563eb]" strokeWidth={1.6} aria-hidden />
      <div className="mt-5 mb-3 text-[32px] font-bold tracking-[-1px]">송장을 찍어 주세요</div>
      <p className="mb-7 text-[#71717a]">하던 상자의 검수 수량은 유지돼요.</p>
      <div className="w-full max-w-[360px]">
        <ScanField placeholder="송장번호 입력 또는 스캔">{children}</ScanField>
      </div>
    </div>
  );
}

function WaitingBatchLine({ batch }: { batch: WaitingBatch }) {
  return (
    <div role="status" aria-label="지금 배치" className="mb-8 flex flex-col items-center gap-1 text-center">
      {batch.name ? <div className="text-sm font-semibold text-[#71717a]">{batch.name}</div> : null}
      <div className="text-sm whitespace-nowrap text-[#71717a] tabular-nums">{batch.code}</div>
      <div className="text-[26px] font-bold tracking-[-0.6px]">
        남은 상자 <span className="text-[#2563eb] tabular-nums">{batch.total - batch.done}</span>
        <span className="text-[#a1a1aa] tabular-nums"> / {batch.total}</span>
      </div>
    </div>
  );
}

/** §5.6 — 송장 바코드가 훼손됐을 때 사람이 친다. Enter 로 보내고 Esc 로 닫는다 */
export function ManualWaybillInput({
  initial,
  onSubmit,
  onClose,
}: {
  initial: string;
  onSubmit(code: string): void;
  onClose(): void;
}) {
  const [value, setValue] = useState(initial);

  return (
    <form
      className="min-w-0 flex-1"
      onSubmit={(e) => {
        e.preventDefault();
        const code = value.trim();
        if (code) onSubmit(code);
      }}
    >
      <input
        aria-label="송장번호"
        autoFocus
        autoComplete="off"
        inputMode="numeric"
        placeholder="송장번호 입력 또는 스캔"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
          }
        }}
        className="w-full border-0 bg-transparent p-[5px] text-sm tabular-nums outline-none"
      />
    </form>
  );
}

/** 오프라인이라 보내지 못한 상품 스캔 — 연결되면 큐가 그대로 보낸다 */
export function scanWaitingMessage(count: number): string {
  return `연결이 끊겨 상품 스캔 ${count}개를 보내지 못하고 있어요. 연결되면 자동으로 보내요. 같은 상품은 다시 찍지 마세요.`;
}

/** 다시 연 박스에 남은 결과 모름 — 무엇을 확인하고 있는지 보여 같은 상품을 또 찍지 않게 한다 */
export function ScanChecking({ scans }: { scans: ReadonlyArray<{ name: string; quantity: number }> }) {
  return (
    <div role="status" className="shrink-0 space-y-1 rounded-xl bg-[#fff1d9] p-4 text-sm text-[#9a681c]">
      <p className="font-semibold">처리 여부를 확인하고 있어요. 이 상품은 다시 찍지 마세요.</p>
      <ul className="list-none">
        {scans.map((scan, i) => (
          <li key={i} className="font-semibold tabular-nums">
            {scan.name} ×{scan.quantity}
          </li>
        ))}
      </ul>
      <p className="text-xs">결과는 아래 상태바 «확인할 일»에서 다시 확인할 수 있어요. 다른 박스는 그대로 찍어도 돼요.</p>
    </div>
  );
}

export function QueueTrouble({ storage, onRetry }: { storage: boolean; onRetry(): void }) {
  return (
    <div role="alert" className="shrink-0 space-y-3 rounded-xl border border-[#d58c85] bg-[#fff4f1] p-4 text-sm text-[#b42318]">
      <p className="font-semibold">{storage ? SCAN_STORAGE_MESSAGE : UNCERTAIN_SCAN_MESSAGE}</p>
      <Button onClick={onRetry}>처리 내역 확인</Button>
    </div>
  );
}
