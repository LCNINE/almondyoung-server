import type { ReviewRow } from '../../domains/inbound-shipment/boxDraft';
import { fmt } from './boxRows';

const CARD = 'rounded-xl border border-[#e4e4e7] bg-white';

/**
 * 확정 확인(스펙 §5.5) — 이 상자만 덮는 줄 중 리스트와 다른 줄, 범위 줄 전부(이 상자 몫은 비교할 수 없어 넣은 값을 다시 보인다),
 * 리스트에 없던 물건 전부. 다 맞으면 «리스트와 같아요» 한 줄.
 */
export function BoxReview({ label, rows }: { label: string; rows: ReviewRow[] }) {
  return (
    <section aria-label="확정 확인" className={`${CARD} min-h-0 flex-1 overflow-auto p-5`}>
      <h3 className="mb-3 text-2xl font-semibold">{label} 확정 — 리스트와 다른 줄</h3>
      {rows.length === 0 ? (
        <p className="text-xl">리스트와 같아요</p>
      ) : (
        <ul className="flex flex-col">
          {rows.map((row, index) => (
            <li key={index} className="flex items-baseline justify-between gap-6 border-b border-[#e4e4e7] py-3 text-xl">
              <span className="font-semibold">{nameOf(row)}</span>
              <span className="font-mono">{valueOf(row)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function nameOf(row: ReviewRow): string {
  if (row.kind === 'range') return `${row.label} (범위 줄)`;
  if (row.kind === 'unplanned') return `${row.label} (리스트에 없던 물건)`;
  return row.label;
}

function valueOf(row: ReviewRow): string {
  if (row.kind === 'range') {
    const total = row.rangeTotal === undefined ? '—' : fmt(row.rangeTotal);
    return `이 상자 ${fmt(row.counted)} (합계 ${total} · 다른 상자 ${fmt(row.elsewhere ?? 0)})`;
  }
  if (row.kind === 'unplanned') return fmt(row.counted);
  return `리스트 ${row.expected === null ? '—' : fmt(row.expected)} → ${fmt(row.counted)}`;
}
