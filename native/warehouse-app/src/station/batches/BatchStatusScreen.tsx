import { useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useWarehouse } from '../../app/warehouse-context';
import { useApiClient } from '../../core/data/ApiClientProvider';
import { localStoragePrefs, type DevicePrefs } from '../../core/data/devicePrefs';
import { loadFailed } from '../../core/data/loadFailed';
import { Button } from '../../core/design/Button';
import { LoadFailure } from '../../core/design/LoadFailure';
import { cn } from '../../core/design/cn';
import { printRaw, readLabelPrinter, type PrintRaw } from '../../core/hardware/print/labelPrinter';
import { BatchLabelPrintButton } from '../../domains/outbound/BatchLabelPrintButton';
import {
  arrangeBatches,
  batchNameOf,
  batchProgressOf,
  boxCountsOf,
  boxRowOf,
  hasCancelPending,
  isNewBatch,
  sortBoxRows,
  useBatchWorkItems,
  type BoxCounts,
  type BoxRow,
} from '../../domains/outbound/batchStatus';
import { formatTrackingNo } from '../../domains/outbound/inspection';
import { JoinBoxPanel } from '../../domains/outbound/JoinBoxPanel';
import { useOutboundBatches } from '../../domains/outbound/queries';
import { writeLastBatch, writeLastBox } from '../../domains/outbound/lastBox';
import { RemoveBoxPanel } from '../../domains/outbound/RemoveBoxPanel';
import { RemovedOnStartNotice, StartBatchButton, type RemovedOnStart } from '../../domains/outbound/StartBatchButton';
import type { OutboundBatchSummary } from '../../domains/outbound/types';
import { fetchBatchLabelStates, type BatchWorkItem } from '../../domains/outbound/waybillLabel';
import { WarehousePicker } from '../../domains/warehouse/WarehousePicker';
import { useBatchProgress } from '../status/batchProgress';

const SECONDARY = 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50';
const TH = 'border-b border-[#D5D8DE] bg-[#F6F7F8] px-4 py-2.5 text-left text-[13px] font-semibold text-[#535968]';

/** 스테이션 F2 배치 현황(스펙 §8, 목업 ⑤) — 관리자 작업, 마우스 허용. 시작·일괄 인쇄·넣기·빼기는 지금 부품 그대로 쓴다 */
export function BatchStatusScreen({ prefs = localStoragePrefs, print = printRaw }: { prefs?: DevicePrefs; print?: PrintRaw }) {
  const { warehouseId } = useWarehouse();
  if (!warehouseId) return <WarehousePicker />;
  return <BatchStatus warehouseId={warehouseId} prefs={prefs} print={print} />;
}

function BatchStatus({ warehouseId, prefs, print }: { warehouseId: string; prefs: DevicePrefs; print: PrintRaw }) {
  const navigate = useNavigate();
  const picking = useOutboundBatches(warehouseId, 'picking');
  const created = useOutboundBatches(warehouseId, 'created');
  const { active, empty } = arrangeBatches(picking.data, created.data);
  const [showEmpty, setShowEmpty] = useState(false);
  // 진행할 배치가 없으면 빈 배치를 접어 둘 이유가 없다
  const emptyShown = showEmpty || active.length === 0;
  // 고를 수 있는 것은 보이는 줄뿐이다 — 접으면 빈 배치를 고른 채 남지 않는다
  const batches = emptyShown ? [...active, ...empty] : active;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panel, setPanel] = useState<'join' | 'remove' | null>(null);
  const [printing, setPrinting] = useState(false);
  const [removedOnStart, setRemovedOnStart] = useState<Record<string, RemovedOnStart>>({});
  // 「작업 시작하고 송장 인쇄」로 시작한 배치 — 인쇄 단추가 처음 그려질 때 한 번 인쇄한다
  const [autoPrintFor, setAutoPrintFor] = useState<string | null>(null);
  const selected = batches.find((batch) => batch.id === selectedId) ?? batches[0] ?? null;
  // 고른 배치를 붙잡는다 — 새 배치가 맨 위로 들어와도 보던 배치가 바뀌지 않게. 끝나서 목록에서 빠지면 맨 위로
  const pinId = selected?.id ?? null;
  useEffect(() => {
    if (pinId !== selectedId && !printing) setSelectedId(pinId);
  }, [pinId, selectedId, printing]);
  // 빈 배치를 보고 있으면 펼친 채 둔다 — 진행할 배치가 새로 들어와도 보던 빈 배치가 접혀 사라지지 않게(접기는 사람이 한다)
  const viewingEmpty = selected !== null && empty.some((batch) => batch.id === selected.id);
  useEffect(() => {
    if (viewingEmpty) setShowEmpty(true);
  }, [viewingEmpty]);
  const items = useBatchWorkItems(selected?.id ?? null);
  useBatchProgress(selected && items.data ? batchProgressOf(selected.batchNumber, items.data) : null);

  const lists = [picking, created];
  const failed = lists.filter(loadFailed);
  const failure =
    failed.length > 0 ? (
      <LoadFailure
        className="shrink-0 text-base"
        message="배치 목록을 불러오지 못했어요."
        error={failed[0].error}
        stale={active.length + empty.length > 0}
        retrying={failed.some((list) => list.isFetching)}
        onRetry={() => failed.forEach((list) => void list.refetch())}
      />
    ) : null;

  if (lists.some((list) => list.isPending && !loadFailed(list)))
    return <p className="p-6 text-lg text-[#535968]">배치 목록을 불러오고 있어요.</p>;
  if (failure && active.length + empty.length === 0) return <div className="p-6">{failure}</div>;
  if (!failure && active.length + empty.length === 0) return <p className="p-6 text-lg text-[#535968]">진행 중인 배치가 없어요.</p>;
  const canPrint = readLabelPrinter(prefs) !== null;

  const select = (id: string) => {
    // 인쇄 중엔 바꾸지 않는다 — 인쇄 단추가 고른 배치에 매여 있다(프린터는 한 대)
    if (printing) return;
    setSelectedId(id);
    setPanel(null);
  };

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_440px] gap-3">
      <section className="flex min-h-0 flex-col gap-3">
        {failure}
        {selected ? (
          <div className="flex shrink-0 flex-wrap items-start gap-2">
            {selected.startedAt === null ? (
              <StartBatchButton
                key={selected.id}
                batchId={selected.id}
                // 프린터가 없으면 시작만 — 시작한 뒤 인쇄 단추가 프린터 설정을 안내한다
                label={canPrint ? '작업 시작하고 송장 인쇄' : '작업 시작'}
                onStarted={(outcome) => {
                  writeLastBatch(prefs, { id: selected.id, batchNumber: selected.batchNumber, name: batchNameOf(selected) });
                  setRemovedOnStart((prev) => ({ ...prev, [selected.id]: outcome }));
                  if (canPrint) setAutoPrintFor(selected.id);
                }}
              />
            ) : (
              <>
                <BatchLabelPrintButton
                  key={selected.id}
                  batchId={selected.id}
                  prefs={prefs}
                  print={print}
                  afterPrinted="이제 F1 «출고 검수»에서 송장을 찍으세요."
                  autoPrint={autoPrintFor === selected.id}
                  onAutoPrintStarted={() => setAutoPrintFor(null)}
                  onRunningChange={(running) => {
                    if (running)
                      writeLastBatch(prefs, { id: selected.id, batchNumber: selected.batchNumber, name: batchNameOf(selected) });
                    setPrinting(running);
                  }}
                />
                <Button type="button" className={cn('mt-2', SECONDARY)} onClick={() => setPanel(panel === 'join' ? null : 'join')}>
                  박스 넣기
                </Button>
                <Button type="button" className={cn('mt-2', SECONDARY)} onClick={() => setPanel(panel === 'remove' ? null : 'remove')}>
                  박스 빼기
                </Button>
              </>
            )}
          </div>
        ) : null}
        {selected && removedOnStart[selected.id] ? <RemovedOnStartNotice outcome={removedOnStart[selected.id]} /> : null}
        {selected && panel === 'join' ? (
          <JoinBoxPanel batchId={selected.id} prefs={prefs} print={print} labelPrinting onClose={() => setPanel(null)} />
        ) : null}
        {selected && panel === 'remove' ? (
          <RemoveBoxPanel
            batchId={selected.id}
            onClose={() => setPanel(null)}
            onWithdrawing={(shipment) => {
              writeLastBox(prefs, shipment);
              void navigate({ to: '/outbound' });
            }}
          />
        ) : null}
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
              {active.map((batch) => (
                <BatchRow key={batch.id} batch={batch} selected={batch.id === selected?.id} onSelect={() => select(batch.id)} />
              ))}
              {empty.length > 0 && active.length > 0 ? (
                <tr className="border-b border-[#E4E6EA]">
                  <td colSpan={4} className="px-4 py-2">
                    <button type="button" className="text-sm text-[#535968] hover:text-[#15171C]" onClick={() => setShowEmpty(!showEmpty)}>
                      {showEmpty ? `빈 배치 ${empty.length}개 접기` : `빈 배치 ${empty.length}개 보기 — 상자가 없는 시작 전 배치`}
                    </button>
                  </td>
                </tr>
              ) : null}
              {emptyShown
                ? empty.map((batch) => (
                    <BatchRow key={batch.id} batch={batch} selected={batch.id === selected?.id} onSelect={() => select(batch.id)} />
                  ))
                : null}
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
        {batchNameOf(batch) ? <span className="ml-3 text-sm text-[#535968]">{batchNameOf(batch)}</span> : null}
      </td>
      <td className="px-4">
        {isNewBatch(batch) ? (
          <span className="font-semibold text-[#1D5BD8]">새 배치</span>
        ) : batch.startedAt === null ? (
          '빈 배치'
        ) : (
          '진행 중'
        )}
      </td>
      <td className="px-4">
        <span className="flex items-center gap-3">
          <span className="h-2 flex-1 rounded bg-[#C9D8F5]">
            <span className="block h-2 rounded bg-[#1D5BD8]" style={{ width: `${percent}%` }} />
          </span>
          <span className="font-mono">{progress ? `${progress.done}/${progress.total}` : `0/${batch.totalBoxes ?? batch.totalItems}`}</span>
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
      <div className="shrink-0">
        <h2 className="font-mono text-2xl font-semibold">{batch.batchNumber}</h2>
        {batchNameOf(batch) ? <p className="text-[15px] text-[#535968]">{batchNameOf(batch)}</p> : null}
      </div>
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
      {counts && counts.withdrawing > 0 ? (
        <p role="status" className="shrink-0 rounded-md bg-[#FFF1C7] px-3 py-2 text-[15px] font-semibold text-[#5E3B00]">
          빠지는 중인 상자는 F1 «출고 검수»에서 송장을 찍고 담은 상품을 꺼내 주세요.
        </p>
      ) : null}
      {hasCancelPending(states.data ?? []) ? (
        <p role="alert" className="shrink-0 rounded-md bg-[#FDECEE] px-3 py-2 text-[15px] font-semibold text-[#9E1320]">
          취소 대기 박스는 박스 빼기로 빼야 취소가 끝나요.
        </p>
      ) : null}
      {rows.length > 0 ? (
        <ol aria-label="박스" className="min-h-0 flex-1 overflow-auto pr-2 [scrollbar-gutter:stable]">
          {/* 스크롤바가 내용 위에 겹치는 웹뷰(리눅스)에서도 오른쪽 상태 칸을 가리지 않게 자리를 잡아 둔다 */}
          {rows.map((row) => (
            <li
              key={row.shipmentId}
              className="grid h-[46px] grid-cols-[160px_minmax(0,1fr)_96px] items-center border-b border-[#EEF0F2] text-[15px]"
            >
              <span className="font-mono">{row.trackingNo ? formatTrackingNo(row.trackingNo) : '송장 없음'}</span>
              <span>{row.recipient}</span>
              <span className={cn('text-right font-semibold', ROW_TONE[row.tone])}>{row.status}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
