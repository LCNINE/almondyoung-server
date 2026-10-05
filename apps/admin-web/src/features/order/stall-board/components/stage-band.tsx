'use client';

import { cn } from '@/lib/utils/ui';
import { BOARD_STAGES, BoardStageKey, formatDwell } from '@/lib/api/domains/orders/order-progress.shape';

export type BandCell = { key: BoardStageKey; open: number; stuck: number; oldestAt: string | null };

/** 위쪽 띠 — 0~8 단계, 점선 오른쪽에 취소·반품·교환(·분류 안 됨은 있을 때만). 설명·범례는 두지 않는다. */
export function StageBand(props: { cells: BandCell[]; selected: BoardStageKey; onSelect: (k: BoardStageKey) => void; now: Date }) {
  const byKey = new Map(props.cells.map((c) => [c.key, c]));
  const main = BOARD_STAGES.slice(0, 9);
  const side = BOARD_STAGES.slice(9).filter((s) => s.key !== 'unclassified' || (byKey.get(s.key)?.open ?? 0) > 0);
  const card = (s: (typeof BOARD_STAGES)[number]) => {
    const c = byKey.get(s.key) ?? { key: s.key, open: 0, stuck: 0, oldestAt: null };
    return (
      <button
        key={s.key}
        type="button"
        onClick={() => props.onSelect(s.key)}
        className={cn(
          'flex min-w-0 flex-col gap-1 rounded-lg border bg-white p-2.5 text-left transition-colors hover:border-slate-400',
          c.open === 0 && 'opacity-50',
          c.stuck > 0 && 'border-t-[3px] border-t-red-600 pt-2',
          props.selected === s.key && 'border-primary ring-1 ring-primary',
        )}
      >
        <span className="truncate text-xs text-muted-foreground">
          {s.no && <b className="mr-1 text-foreground tabular-nums">{s.no}</b>}
          {s.name}
        </span>
        <span className="text-[22px] font-bold leading-tight tabular-nums">{c.open.toLocaleString('ko-KR')}</span>
        <span className="min-h-4 text-xs font-semibold text-red-600 tabular-nums">
          {c.stuck > 0 ? `갇힘 ${c.stuck.toLocaleString('ko-KR')}` : ''}
        </span>
        <span className="min-h-3.5 text-[11px] text-muted-foreground">
          {c.oldestAt ? `최장 ${formatDwell(props.now.getTime() - new Date(c.oldestAt).getTime())}` : ''}
        </span>
      </button>
    );
  };
  return (
    <div
      className="grid gap-2"
      style={{ gridTemplateColumns: `repeat(9, minmax(0, 1fr)) 14px repeat(${side.length}, minmax(0, 1fr))` }}
    >
      {main.map(card)}
      <div className="mx-1.5 my-1.5 border-l border-dashed" />
      {side.map(card)}
    </div>
  );
}
