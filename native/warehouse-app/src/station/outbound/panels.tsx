import { useState, type ReactNode } from 'react';
import { Check, Package, Printer, ScanLine, X } from 'lucide-react';
import { Button } from '../../core/design/Button';
import { cn } from '../../core/design/cn';
import { SCAN_STORAGE_MESSAGE } from '../../core/hardware/scan/useWorkScanQueue';
import { formatTrackingNo, type InspectionRow } from '../../domains/outbound/inspection';
import type { LabelItemChange } from '../../domains/outbound/waybillLabel';
import { Kbd } from '../Kbd';
import type { LastBox } from './model';
import { clockOf, type RecentEntry, type RecentKind } from './recent';
import { UNCERTAIN_SCAN_MESSAGE } from './useInspectionBox';

const CARD = 'rounded-[10px] border border-[#D5D8DE] bg-white';

/** 출고 검수 작업 영역 — 왼쪽 380px(송장·큰 칸), 오른쪽 나머지(표·최근). 셸 <main> 이 이미 p-3 이다 */
export function WorkGrid({ left, right, intake }: { left: ReactNode; right: ReactNode; intake?: 'open' | 'blocked' }) {
  return (
    <div data-intake={intake} className="grid h-full min-h-0 grid-cols-[380px_minmax(0,1fr)] gap-3">
      <section className="flex min-h-0 flex-col gap-3">{left}</section>
      <section className="flex min-h-0 flex-col gap-3">{right}</section>
    </div>
  );
}

export function BoxCard({
  trackingNo,
  recipient,
  deliveryNote,
}: {
  trackingNo: string;
  recipient: string;
  deliveryNote?: string | null;
}) {
  return (
    <div className={cn(CARD, 'flex shrink-0 flex-col gap-2.5 p-[18px]')}>
      <h2 className="font-mono text-[30px] font-semibold">{formatTrackingNo(trackingNo)}</h2>
      <div className="text-lg font-medium">{recipient}</div>
      {deliveryNote ? (
        <div className="rounded-md bg-[#FFF1C7] px-3 py-2.5 text-base font-semibold text-[#5E3B00]">{deliveryNote}</div>
      ) : null}
    </div>
  );
}

export type BigPanelContent =
  | { kind: 'progress'; scanned: number; ordered: number }
  | { kind: 'quantity'; value: string }
  | { kind: 'armed'; keyLabel: string; label: string }
  | { kind: 'alert'; message: string; detail?: string }
  | { kind: 'notice'; title: string; message?: string };

/** 왼쪽 아래 큰 칸 — 지금 찍을 것과 진행(거대), 또는 오류·안내 하나(스펙 §6.4) */
export function BigPanel({ content }: { content: BigPanelContent }) {
  const base = 'flex min-h-0 flex-1 flex-col items-center justify-center gap-4 rounded-[10px] p-6 text-center';
  switch (content.kind) {
    case 'progress':
      return (
        <div role="status" aria-label="진행" className={cn(base, 'border border-[#D5D8DE] bg-white')}>
          <div className="text-[30px] font-bold text-[#1D5BD8]">상품 바코드</div>
          <div className="font-mono text-[120px] font-semibold leading-none tracking-tight">
            {content.scanned}
            <span className="text-[#A3A9B4]"> / {content.ordered}</span>
          </div>
        </div>
      );
    case 'quantity':
      return (
        <div role="status" aria-label="수량" className={cn(base, 'border-2 border-[#1D5BD8] bg-white')}>
          <div className="text-[30px] font-bold text-[#1D5BD8]">수량</div>
          <div className="font-mono text-[120px] font-semibold leading-none">{content.value || '_'}</div>
        </div>
      );
    case 'armed':
      return (
        <div role="status" className={cn(base, 'border-2 border-[#D99A00] bg-[#FFF1C7] text-[#5E3B00]')}>
          <div className="text-[32px] font-bold">{content.label}</div>
          <div className="flex items-center gap-2 text-lg font-semibold">
            <Kbd>{content.keyLabel}</Kbd> 한 번 더
          </div>
        </div>
      );
    case 'alert':
      return (
        <div role="alert" className={cn(base, 'border-2 border-[#C8202F] bg-[#FDE8EA]')}>
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-[#C8202F] text-white">
            <X className="h-11 w-11" aria-hidden />
          </div>
          <div className="text-[28px] font-bold text-[#9E1320]">{content.message}</div>
          {content.detail ? <div className="font-mono text-xl font-semibold">{content.detail}</div> : null}
        </div>
      );
    case 'notice':
      return (
        <div role="status" className={cn(base, 'border-2 border-[#D99A00] bg-[#FFF1C7] text-[#5E3B00]')}>
          <div className="text-[32px] font-bold">{content.title}</div>
          {content.message ? <div className="text-lg font-semibold">{content.message}</div> : null}
        </div>
      );
  }
}

const TH = 'border-b border-[#D5D8DE] bg-[#F6F7F8] px-4 py-2.5 text-left text-[13px] font-semibold text-[#535968]';

/** 품목 표 `위치 | 상품 | 주문 | 스캔` — 완료 줄 회색, 방금 찍은 줄 노랑, 수량 2 이상은 ×N(스펙 §6.4). 위치는 보여 주기만 */
export function LineTable({ rows, currentLineId }: { rows: readonly InspectionRow[]; currentLineId: string | null }) {
  return (
    <div className={cn(CARD, 'min-h-0 flex-1 overflow-auto')}>
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className={cn(TH, 'w-[120px]')}>위치</th>
            <th className={TH}>상품</th>
            <th className={cn(TH, 'w-[90px] text-right')}>주문</th>
            <th className={cn(TH, 'w-[140px] text-right')}>스캔</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const current = !row.done && row.shipmentLineId === currentLineId;
            return (
              <tr
                key={row.shipmentLineId}
                data-state={row.done ? 'done' : current ? 'current' : 'todo'}
                className={cn(
                  'h-[72px] border-b border-[#E4E6EA] text-[17px]',
                  row.done && 'bg-[#F1F2F4] text-[#6B717D]',
                  current && 'bg-[#FFF1C7]'
                )}
              >
                <td className="px-4 font-mono font-semibold">{row.locations || '—'}</td>
                <td className={cn('px-4', !row.done && 'font-semibold')}>{row.name}</td>
                <td className="px-4 text-right font-mono">
                  {row.ordered >= 2 ? (
                    <span className="rounded bg-[#7A4B00] px-2 py-0.5 font-semibold text-white">×{row.ordered}</span>
                  ) : (
                    row.ordered
                  )}
                </td>
                <td className="px-4 text-right font-mono">
                  {row.done ? (
                    <span className="inline-flex items-center gap-2 font-semibold text-[#1E7A46]">
                      <Check className="h-5 w-5" aria-hidden />
                      {row.scanned}
                    </span>
                  ) : (
                    <span className={cn('text-2xl font-semibold', row.scanned > 0 ? 'text-[#1D5BD8]' : 'text-[#A3A9B4]')}>
                      {row.scanned}
                      <span className="text-[17px] text-[#7C828E]"> / {row.ordered}</span>
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** 송장이 바뀐 줄 `위치 | 상품 | 송장 → 지금`(목업 ④) */
export function ChangeTable({ changes }: { changes: readonly LabelItemChange[] }) {
  return (
    <div className={cn(CARD, 'min-h-0 flex-1 overflow-auto')}>
      <table className="w-full border-collapse text-[#535968]">
        <thead>
          <tr>
            <th className={cn(TH, 'w-[120px]')}>위치</th>
            <th className={TH}>상품</th>
            <th className={cn(TH, 'w-[180px] text-right')}>송장 → 지금</th>
          </tr>
        </thead>
        <tbody>
          {changes.map((change) => (
            <tr key={`${change.locationCode}-${change.skuId}`} className="h-[72px] border-b border-[#E4E6EA] text-[17px]">
              <td className="px-4 font-mono font-semibold text-[#15171C]">{change.locationCode}</td>
              <td className="px-4 font-semibold text-[#15171C]">{change.name}</td>
              <td className="px-4 text-right font-mono text-xl">
                <span className="line-through">{change.printedQty}</span> → <strong className="text-[#15171C]">{change.currentQty}</strong>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const RECENT_ICON: Record<RecentKind, typeof Check> = {
  waybill: ScanLine,
  scan: Check,
  shipped: Package,
  printed: Printer,
  error: X,
};
const RECENT_TONE: Record<RecentKind, string> = {
  waybill: 'text-[#1D5BD8]',
  scan: 'text-[#1E7A46]',
  shipped: 'text-[#1E7A46]',
  printed: 'text-[#7A4B00]',
  error: 'text-[#9E1320]',
};

function recentText(entry: RecentEntry): string {
  if (entry.kind === 'shipped') return `${formatTrackingNo(entry.text)} 출고 완료`;
  if (entry.kind === 'printed') return `${formatTrackingNo(entry.text)} 새 송장 출력`;
  if (entry.kind === 'waybill') return formatTrackingNo(entry.text);
  return entry.text;
}

/** 최근 스캔(목업 ②) — 비었으면 그리지 않는다(U2) */
export function RecentList({ entries, grow = false }: { entries: readonly RecentEntry[]; grow?: boolean }) {
  if (entries.length === 0) return null;
  return (
    <ol
      aria-label="최근 스캔"
      className={cn(CARD, 'list-none overflow-hidden px-4 py-1.5 text-[15px]', grow ? 'min-h-0 flex-1' : 'h-[172px] shrink-0')}
    >
      {entries.map((entry) => {
        const Icon = RECENT_ICON[entry.kind];
        return (
          <li
            key={entry.id}
            className={cn(
              'grid h-10 grid-cols-[84px_28px_minmax(0,1fr)_auto] items-center border-b border-[#EEF0F2] last:border-b-0',
              entry.kind === 'error' && 'bg-[#FDE8EA] font-semibold text-[#9E1320]'
            )}
          >
            <span className="font-mono text-[#535968]">{clockOf(entry.at)}</span>
            <Icon className={cn('h-4 w-4', RECENT_TONE[entry.kind])} aria-hidden />
            <span className="truncate">{recentText(entry)}</span>
            <span className="font-mono font-semibold">{entry.qty ? `+${entry.qty}` : ''}</span>
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
      <div className="flex shrink-0 items-center gap-[18px] rounded-[10px] border border-[#8CC8A4] bg-[#E3F4EA] px-[22px] py-5">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#1E7A46] text-white">
          <Check className="h-8 w-8" aria-hidden />
        </span>
        <span className="font-mono text-[28px] font-semibold">{formatTrackingNo(last.trackingNo)}</span>
        <span className="text-xl font-semibold text-[#145232]">출고 완료</span>
      </div>
    );
  return (
    <div className="shrink-0 overflow-hidden rounded-[10px] border-2 border-[#D99A00] bg-white">
      <div className="flex h-10 items-center gap-2.5 bg-[#FFF1C7] px-4 text-[15px] font-bold text-[#5E3B00]">
        <span className="font-mono">{formatTrackingNo(last.trackingNo)}</span> 보충 대기
      </div>
      <ul className="px-4 py-2 text-base">
        {last.items.map((item) => (
          <li key={`${item.locationCode}-${item.name}`} className="py-1">
            <span className="font-mono font-semibold">[{item.locationCode}]</span> {item.name}{' '}
            <span className="font-mono font-semibold">×{item.qty}</span>
          </li>
        ))}
      </ul>
      {last.print.kind === 'failed' ? (
        <p role="alert" className="border-t border-[#EEF0F2] px-4 py-2 font-semibold text-[#9E1320]">
          {last.print.message}
        </p>
      ) : null}
    </div>
  );
}

/** 송장 대기(목업 ①) — 직접 입력칸이 열리면 그 안에 그린다 */
export function WaitingPrompt({ children }: { children?: ReactNode }) {
  return (
    <div className={cn(CARD, 'flex min-h-0 flex-1 flex-col items-center justify-center gap-5')}>
      <div className="flex h-[120px] w-[120px] items-center justify-center rounded-3xl bg-[#E3ECFC] text-[#1D5BD8]">
        <ScanLine className="h-[68px] w-[68px]" strokeWidth={1.6} aria-hidden />
      </div>
      <div className="text-4xl font-bold">송장 바코드</div>
      {children}
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
      className="w-[300px]"
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
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
          }
        }}
        className="w-full rounded-md border border-[#D5D8DE] px-3 py-2 font-mono text-2xl"
      />
    </form>
  );
}

/** 스캔을 저장하지 못했거나 결과를 모를 때 — 같은 상품을 다시 찍지 않게 하고 확인 단추를 준다 */
export function QueueTrouble({ storage, onRetry }: { storage: boolean; onRetry(): void }) {
  return (
    <div role="alert" className="shrink-0 space-y-2 rounded-[10px] border-2 border-[#C8202F] bg-[#FDE8EA] p-3 text-[#9E1320]">
      <p className="font-semibold">{storage ? SCAN_STORAGE_MESSAGE : UNCERTAIN_SCAN_MESSAGE}</p>
      <Button onClick={onRetry}>처리 내역 확인</Button>
    </div>
  );
}
