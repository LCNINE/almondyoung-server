import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useWarehouse } from '../../app/warehouse-context';
import { useApiClient } from '../../core/data/ApiClientProvider';
import { localStoragePrefs, type DevicePrefs } from '../../core/data/devicePrefs';
import { Button } from '../../core/design/Button';
import { cn } from '../../core/design/cn';
import { printRaw, type PrintRaw } from '../../core/hardware/print/labelPrinter';
import { BatchLabelPrintButton } from '../../domains/outbound/BatchLabelPrintButton';
import {
  batchProgressOf,
  boxCountsOf,
  boxRowOf,
  mergeBatches,
  sortBoxRows,
  useBatchWorkItems,
  type BoxCounts,
  type BoxRow,
} from '../../domains/outbound/batchStatus';
import { formatTrackingNo } from '../../domains/outbound/inspection';
import { JoinBoxPanel } from '../../domains/outbound/JoinBoxPanel';
import { useOutboundBatches } from '../../domains/outbound/queries';
import { RemoveBoxPanel } from '../../domains/outbound/RemoveBoxPanel';
import { StartBatchButton } from '../../domains/outbound/StartBatchButton';
import type { OutboundBatchSummary } from '../../domains/outbound/types';
import { fetchBatchLabelStates, type BatchWorkItem } from '../../domains/outbound/waybillLabel';
import { WarehousePicker } from '../../domains/warehouse/WarehousePicker';
import { useBatchProgress } from '../status/batchProgress';

const TH = 'border-b border-[#D5D8DE] bg-[#F6F7F8] px-4 py-2.5 text-left text-[13px] font-semibold text-[#535968]';

/** 스테이션 F2 배치 현황(스펙 §8, 목업 ⑤) — 관리자 작업, 마우스 허용. 시작·일괄 인쇄·넣기·빼기는 지금 부품 그대로 쓴다 */
export function BatchStatusScreen({ prefs = localStoragePrefs, print = printRaw }: { prefs?: DevicePrefs; print?: PrintRaw }) {
  const { warehouseId } = useWarehouse();
  if (!warehouseId) return <WarehousePicker />;
  return <BatchStatus warehouseId={warehouseId} prefs={prefs} print={print} />;
}

function BatchStatus({ warehouseId, prefs, print }: { warehouseId: string; prefs: DevicePrefs; print: PrintRaw }) {
  const picking = useOutboundBatches(warehouseId, 'picking');
  const created = useOutboundBatches(warehouseId, 'created');
  const batches = mergeBatches(picking.data, created.data);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panel, setPanel] = useState<'join' | 'remove' | null>(null);
  const [printing, setPrinting] = useState(false);
  const selected = batches.find((batch) => batch.id === selectedId) ?? batches[0] ?? null;
  const items = useBatchWorkItems(selected?.id ?? null);
  useBatchProgress(selected && items.data ? batchProgressOf(selected.batchNumber, items.data) : null);

  if (picking.isSuccess && created.isSuccess && batches.length === 0)
    return <p className="p-6 text-lg text-[#535968]">진행 중인 배치가 없어요.</p>;

  const select = (id: string) => {
    // 인쇄 중엔 바꾸지 않는다 — 인쇄 단추가 고른 배치에 매여 있다(프린터는 한 대)
    if (printing) return;
    setSelectedId(id);
    setPanel(null);
  };

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_440px] gap-3">
      <section className="flex min-h-0 flex-col gap-3">
        {selected ? (
          <div className="flex shrink-0 flex-wrap items-start gap-2">
            {selected.startedAt === null ? (
              <StartBatchButton key={selected.id} batchId={selected.id} />
            ) : (
              <>
                <BatchLabelPrintButton key={selected.id} batchId={selected.id} prefs={prefs} print={print} onRunningChange={setPrinting} />
                <Button type="button" className="mt-2" onClick={() => setPanel(panel === 'join' ? null : 'join')}>
                  박스 넣기
                </Button>
                <Button type="button" className="mt-2" onClick={() => setPanel(panel === 'remove' ? null : 'remove')}>
                  박스 빼기
                </Button>
              </>
            )}
          </div>
        ) : null}
        {selected && panel === 'join' ? (
          <JoinBoxPanel batchId={selected.id} prefs={prefs} print={print} labelPrinting onClose={() => setPanel(null)} />
        ) : null}
        {selected && panel === 'remove' ? <RemoveBoxPanel batchId={selected.id} onClose={() => setPanel(null)} /> : null}
        <div className="min-h-0 flex-1 overflow-auto rounded-[10px] border border-[#D5D8DE] bg-white">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={TH}>배치</th>
                <th className={cn(TH, 'w-28')}>상태</th>
                <th className={TH}>진행</th>
                <th className={cn(TH, 'w-28 text-right')}>빠지는 중</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((batch) => (
                <BatchRow key={batch.id} batch={batch} selected={batch.id === selected?.id} onSelect={() => select(batch.id)} />
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {selected ? <BatchDetail batch={selected} items={items.data} /> : null}
    </div>
  );
}

function BatchRow({ batch, selected, onSelect }: { batch: OutboundBatchSummary; selected: boolean; onSelect(): void }) {
  const items = useBatchWorkItems(batch.id);
  const progress = items.data ? batchProgressOf(batch.batchNumber, items.data) : null;
  const percent = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  return (
    <tr className={cn('h-14 border-b border-[#E4E6EA] text-base', selected && 'bg-[#E3ECFC]')}>
      <td className="px-4">
        <button type="button" onClick={onSelect} className="font-mono font-semibold">
          {batch.batchNumber}
        </button>
      </td>
      <td className="px-4">{batch.startedAt === null ? '시작 전' : '진행 중'}</td>
      <td className="px-4">
        <span className="flex items-center gap-3">
          <span className="h-2 flex-1 rounded bg-[#C9D8F5]">
            <span className="block h-2 rounded bg-[#1D5BD8]" style={{ width: `${percent}%` }} />
          </span>
          <span className="font-mono">{progress ? `${progress.done}/${progress.total}` : `0/${batch.totalItems}`}</span>
        </span>
      </td>
      <td className="px-4 text-right font-mono">{batch.withdrawingItems > 0 ? batch.withdrawingItems : ''}</td>
    </tr>
  );
}

const COUNT_CELLS: ReadonlyArray<{ key: keyof BoxCounts; label: string; tone: string }> = [
  { key: 'done', label: '완료', tone: 'bg-[#E3F4EA] text-[#145232]' },
  { key: 'working', label: '검수 중', tone: 'bg-[#E3ECFC] text-[#123E99]' },
  { key: 'waiting', label: '대기', tone: 'bg-[#F1F2F4] text-[#3F4450]' },
  { key: 'withdrawing', label: '빠지는 중', tone: 'bg-[#FFF1C7] text-[#5E3B00]' },
];

const ROW_TONE: Record<BoxRow['tone'], string> = {
  alert: 'text-[#9E1320]',
  warn: 'text-[#7A4B00]',
  work: 'text-[#123E99]',
  idle: 'text-[#535968]',
};

function BatchDetail({ batch, items }: { batch: OutboundBatchSummary; items: BatchWorkItem[] | undefined }) {
  const api = useApiClient();
  // 일괄 인쇄 단추와 같은 키 — 인쇄·넣기·빼기 뒤의 무효화가 여기에도 닿는다
  const states = useQuery({
    queryKey: ['waybill-label-states', batch.id],
    queryFn: () => fetchBatchLabelStates(api, batch.id),
  });
  const counts = items ? boxCountsOf(items) : null;
  const rows = sortBoxRows(
    (states.data ?? []).flatMap((state) => {
      const row = boxRowOf(state);
      return row ? [row] : [];
    })
  );
  return (
    <section aria-label="배치 상세" className="flex min-h-0 flex-col gap-3 rounded-[10px] border border-[#D5D8DE] bg-white p-4">
      <h2 className="font-mono text-2xl font-semibold">{batch.batchNumber}</h2>
      {counts ? (
        <div className="grid shrink-0 grid-cols-4 gap-2 text-center text-sm">
          {COUNT_CELLS.map((cell) => (
            <div key={cell.key} aria-label={cell.label} className={cn('rounded-md py-1.5', cell.tone)}>
              <div className="font-mono text-xl font-semibold">{counts[cell.key]}</div>
              {cell.label}
            </div>
          ))}
        </div>
      ) : null}
      {rows.length > 0 ? (
        <ol aria-label="박스" className="min-h-0 flex-1 overflow-auto pr-2 [scrollbar-gutter:stable]">
          {/* 스크롤바가 내용 위에 겹치는 웹뷰(리눅스)에서도 오른쪽 상태 칸을 가리지 않게 자리를 잡아 둔다 */}
          {rows.map((row) => (
            <li
              key={row.shipmentId}
              className="grid h-[46px] grid-cols-[160px_minmax(0,1fr)_96px] items-center border-b border-[#EEF0F2] text-[15px]"
            >
              <span className="font-mono">{formatTrackingNo(row.trackingNo)}</span>
              <span>{row.recipient}</span>
              <span className={cn('text-right font-semibold', ROW_TONE[row.tone])}>{row.status}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
