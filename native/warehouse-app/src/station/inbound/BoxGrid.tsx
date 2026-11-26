import { useEffect, useRef } from 'react';
import { cn } from '../../core/design/cn';
import { isRangeLine, type BoxDraft } from '../../domains/inbound-shipment/boxDraft';
import type { BoxLine } from '../../domains/inbound-shipment/types';
import { coverRange, fmt, rowKey, type BoxRow, type GridValues } from './boxRows';

const CARD = 'rounded-xl border border-[#e4e4e7] bg-white';
const TH = 'border-b border-[#e4e4e7] bg-[#fafafa] px-4 py-3 text-left text-[11px] font-medium whitespace-nowrap text-[#71717a]';

type CellState = 'blank' | 'counted' | 'list';

/** 상자 작업(·확정된 상자)의 오른쪽 표 — 제품명·옵션 | 우리 상품 | 리스트 | 센 수량. cursor -1 이면 고른 줄 없음 */
export function BoxGrid({ rows, draft, cursor }: { rows: BoxRow[]; draft: GridValues; cursor: number }) {
  return (
    <div className={cn(CARD, 'min-h-0 flex-1 overflow-auto')}>
      <table aria-label="상자 줄" className="w-full border-collapse">
        <thead>
          <tr>
            <th className={TH}>제품명 · 옵션</th>
            <th className={TH}>우리 상품</th>
            <th className={cn(TH, 'w-[200px] text-right')}>리스트</th>
            <th className={cn(TH, 'w-[140px] text-right')}>센 수량</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <GridRow key={rowKey(row)} row={row} draft={draft} selected={index === cursor} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GridRow({ row, draft, selected }: { row: BoxRow; draft: GridValues; selected: boolean }) {
  const ref = useRef<HTMLTableRowElement>(null);
  // ↑↓·스캔으로 고른 줄이 화면 밖이면 따라간다(jsdom 엔 scrollIntoView 가 없다)
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView?.({ block: 'nearest' });
  }, [selected]);
  let state: CellState;
  let value: number | null;
  if (row.kind === 'line') {
    const cell = draft.cells[row.line.lineId];
    state = !cell ? 'blank' : cell.method;
    value = cell?.qty ?? null;
  } else {
    state = 'counted';
    value = row.item.qty;
  }
  return (
    <tr
      ref={ref}
      data-row={rowKey(row)}
      aria-selected={selected}
      className={cn('h-[64px] border-b border-[#e4e4e7] text-[17px]', selected && 'bg-[#eff6ff]')}
    >
      {row.kind === 'line' ? <LineCells line={row.line} /> : <UnplannedCells item={row.item} />}
      <td
        data-col="qty"
        data-state={state}
        data-qty={value ?? undefined}
        aria-label={state === 'blank' ? '빈칸' : state === 'list' ? `리스트대로 ${value}` : `센 수량 ${value}`}
        className={cn(
          'px-4 text-right font-mono text-2xl font-semibold',
          state === 'blank' && 'bg-[#f4f4f5]',
          state === 'list' && 'text-[#2563eb]',
          selected && 'outline outline-2 -outline-offset-2 outline-[#2563eb]'
        )}
      >
        {value ?? ''}
        {state === 'list' ? <span className="ml-1 text-lg text-[#2563eb]">≡</span> : null}
      </td>
    </tr>
  );
}

function LineCells({ line }: { line: BoxLine }) {
  return (
    <>
      <td className="px-4">
        <div className="font-semibold">{line.option ? `${line.productName} · ${line.option}` : line.productName}</div>
        {line.remark ? <div className="text-sm text-[#71717a]">{line.remark}</div> : null}
      </td>
      <td className="px-4 text-[15px]">
        {line.kind === 'free' ? (
          <span className="text-[#71717a]">자유 줄</span>
        ) : line.sku ? (
          <>
            <span className="font-mono">{line.sku.code}</span> {line.sku.name}
          </>
        ) : (
          '—'
        )}
      </td>
      <td className="px-4 text-right font-mono">
        {isRangeLine(line) ? (
          <>
            <div>
              {coverRange(line)} 합계 {line.expectedQty === null ? '—' : fmt(line.expectedQty)}
            </div>
            <div className="text-sm text-[#71717a]">다른 상자 {fmt(line.alreadyCountedInOtherBoxes)}</div>
          </>
        ) : line.expectedQty === null ? (
          '—'
        ) : (
          fmt(line.expectedQty)
        )}
      </td>
    </>
  );
}

function UnplannedCells({ item }: { item: BoxDraft['unplanned'][number] }) {
  return (
    <>
      <td className="px-4">
        <div className="font-semibold">+ 리스트에 없던 물건: {item.skuName}</div>
      </td>
      <td className="px-4 font-mono text-[15px]">{item.skuCode}</td>
      <td className="px-4 text-right font-mono">—</td>
    </>
  );
}
