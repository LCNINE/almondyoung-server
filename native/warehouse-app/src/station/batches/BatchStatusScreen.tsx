import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Package, Printer } from 'lucide-react';
import { useWarehouse } from '../../app/warehouse-context';
import { useApiClient } from '../../core/data/ApiClientProvider';
import { localStoragePrefs, type DevicePrefs } from '../../core/data/devicePrefs';
import { errorMessage } from '../../core/data/errorMessage';
import { loadFailed } from '../../core/data/loadFailed';
import { Button } from '../../core/design/Button';
import { LoadFailure } from '../../core/design/LoadFailure';
import { ScreenHeader } from '../../core/design/ScreenHeader';
import { cn } from '../../core/design/cn';
import { printRaw, readLabelPrinter, type PrintRaw } from '../../core/hardware/print/labelPrinter';
import { BatchLabelPrintButton } from '../../domains/outbound/BatchLabelPrintButton';
import {
  arrangeBatches,
  batchNameOf,
  batchProgressOf,
  boxAttentionOf,
  boxCountsOf,
  boxRowOf,
  hasCancelPending,
  isNewBatch,
  sortBoxRows,
  todayBatchCount,
  useBatchWorkItems,
  withRefillPending,
  type BoxRow,
} from '../../domains/outbound/batchStatus';
import { formatTrackingNo } from '../../domains/outbound/inspection';
import { JoinBoxPanel } from '../../domains/outbound/JoinBoxPanel';
import { useOutboundBatches, useShipmentByWaybill } from '../../domains/outbound/queries';
import { writeLastBatch, writeLastBox } from '../../domains/outbound/lastBox';
import { usePendingRefills } from '../../domains/outbound/refills';
import { RemoveBoxPanel } from '../../domains/outbound/RemoveBoxPanel';
import { ReprintLabelButton } from '../../domains/outbound/ReprintLabelButton';
import { RemovedOnStartNotice, StartBatchButton, type RemovedOnStart } from '../../domains/outbound/StartBatchButton';
import type { OutboundBatchSummary } from '../../domains/outbound/types';
import { fetchBatchLabelStates, type BatchWorkItem } from '../../domains/outbound/waybillLabel';
import { WarehousePicker } from '../../domains/warehouse/WarehousePicker';
import { useBatchProgress } from '../status/batchProgress';

const DESCRIPTION = '배치를 선택하고, 송장과 진행 상황을 확인하세요.';
const PANEL = 'min-w-0 overflow-hidden rounded-xl border border-[#e4e4e7] bg-white';
const PANEL_HEAD = 'flex items-start justify-between gap-2.5 border-b border-[#e4e4e7] px-[22px] py-[19px]';
const OUTLINE = 'gap-2 border border-[#e4e4e7] bg-white text-[#27272a] hover:bg-[#eff6ff] hover:brightness-100';
const SMALL = 'px-2.5 py-[7px] text-xs';
const PILL = 'inline-flex shrink-0 items-center rounded-[5px] px-2 py-[5px] text-xs font-semibold whitespace-nowrap';
const PILL_BLUE = 'bg-[#eff6ff] text-[#2563eb]';
const PILL_WARN = 'bg-[#fff1d9] text-[#925e13]';
const PILL_RED = 'bg-[#fcebe8] text-[#a94035]';
const PILL_GRAY = 'bg-[#eff1f2] text-[#68706d]';
const TH = 'px-4 py-3 text-left text-xs font-medium text-[#71717a]';
const NOTE = 'rounded-[10px] px-4 py-3 text-[13px] font-semibold';
const MUTED = 'text-[#71717a]';

/** 스테이션 F2 배치 현황(스펙 §8, 목업 ⑤) — 관리자 작업, 마우스 허용. 시작·일괄 인쇄·넣기·빼기는 지금 부품 그대로 쓴다 */
export function BatchStatusScreen({ prefs = localStoragePrefs, print = printRaw }: { prefs?: DevicePrefs; print?: PrintRaw }) {
  const { warehouseId } = useWarehouse();
  if (!warehouseId) return <WarehousePicker />;

  return <BatchStatus warehouseId={warehouseId} prefs={prefs} print={print} />;
}

function Frame({ today, children }: { today: number | null; children: ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-5">
      <ScreenHeader
        title="배치 현황"
        description={DESCRIPTION}
        right={today !== null ? <span className={cn(PILL, PILL_BLUE)}>오늘 {today}개 배치</span> : undefined}
      />
      {children}
    </div>
  );
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
  // 피킹 목록에서 돌아오면 보던 배치를 다시 고른다
  const returnedTo = useRouterState({ select: (state) => state.location.state.batchId });
  const [selectedId, setSelectedId] = useState<string | null>(returnedTo ?? null);
  const [panel, setPanel] = useState<'join' | 'remove' | null>(null);
  const [batchPrinting, setBatchPrinting] = useState(false);
  const [boxPrinting, setBoxPrinting] = useState(false);
  const printing = batchPrinting || boxPrinting;
  const [removedOnStart, setRemovedOnStart] = useState<Record<string, RemovedOnStart>>({});
  // 배치 시작으로 시작한 배치 — 인쇄 단추가 처음 그려질 때 한 번 인쇄한다
  const [autoPrintFor, setAutoPrintFor] = useState<string | null>(null);
  const selected = batches.find((batch) => batch.id === selectedId) ?? batches[0] ?? null;
  // 고른 배치를 붙잡는다 — 새 배치가 맨 위로 들어와도 보던 배치가 바뀌지 않게. 끝나서 목록에서 빠지면 맨 위로
  const pinId = selected?.id ?? null;
  // 목록이 오기 전엔 붙잡지 않는다 — 돌아와 고를 배치를 빈 목록으로 지우지 않게. 한쪽이 실패했으면 보이는 줄로 붙잡는다
  const listed = [picking, created].every((list) => list.data !== undefined || loadFailed(list));
  useEffect(() => {
    if (listed && pinId !== selectedId && !printing) setSelectedId(pinId);
  }, [listed, pinId, selectedId, printing]);
  // 빈 배치를 보고 있으면 펼친 채 둔다 — 진행할 배치가 새로 들어와도 보던 빈 배치가 접혀 사라지지 않게(접기는 사람이 한다)
  const viewingEmpty = selected !== null && empty.some((batch) => batch.id === selected.id);
  useEffect(() => {
    if (viewingEmpty) setShowEmpty(true);
  }, [viewingEmpty]);
  const items = useBatchWorkItems(selected?.id ?? null);
  useBatchProgress(selected && items.data ? batchProgressOf(selected.batchNumber, items.data) : null);
  const lookup = useShipmentByWaybill(warehouseId);
  const [openError, setOpenError] = useState<string | null>(null);

  const lists = [picking, created];
  const failed = lists.filter(loadFailed);
  const today = listed ? todayBatchCount([...active, ...empty], new Date()) : null;
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
    return (
      <Frame today={null}>
        <p className={cn('text-[13px]', MUTED)}>배치 목록을 불러오고 있어요.</p>
      </Frame>
    );
  if (failure && active.length + empty.length === 0) return <Frame today={null}>{failure}</Frame>;
  if (!failure && active.length + empty.length === 0)
    return (
      <Frame today={today}>
        <p className={cn('text-[13px]', MUTED)}>진행 중인 배치가 없어요.</p>
      </Frame>
    );
  const canPrint = readLabelPrinter(prefs) !== null;

  const select = (id: string) => {
    // 인쇄 중엔 바꾸지 않는다 — 인쇄 단추가 고른 배치에 매여 있다(프린터는 한 대)
    if (printing) return;
    setSelectedId(id);
    setPanel(null);
    setOpenError(null);
  };

  const openBox = async (trackingNo: string) => {
    if (printing || lookup.isPending) return;
    setOpenError(null);
    try {
      const shipment = await lookup.mutateAsync(trackingNo);
      writeLastBox(prefs, shipment);
      void navigate({ to: '/outbound' });
    } catch (error) {
      setOpenError(errorMessage(error, 'outbound'));
    }
  };

  const actions = selected ? (
    selected.startedAt === null ? (
      <>
        <Button type="button" disabled className={OUTLINE}>
          <Printer className="h-4 w-4" aria-hidden />
          송장 일괄 출력
        </Button>
        <StartBatchButton
          key={selected.id}
          batchId={selected.id}
          label="배치 시작"
          onStarted={(outcome) => {
            writeLastBatch(prefs, { id: selected.id, batchNumber: selected.batchNumber, name: batchNameOf(selected) });
            setRemovedOnStart((prev) => ({ ...prev, [selected.id]: outcome }));
            // 프린터가 없으면 시작만 — 시작한 뒤 인쇄 단추가 프린터 설정을 안내한다
            if (canPrint) setAutoPrintFor(selected.id);
          }}
        />
      </>
    ) : (
      <>
        <Button
          type="button"
          className={OUTLINE}
          onClick={() => void navigate({ to: '/outbound/batches/$batchId/pick-list', params: { batchId: selected.id } })}
        >
          피킹 목록
        </Button>
        <Button type="button" className={OUTLINE} onClick={() => setPanel(panel === 'join' ? null : 'join')}>
          박스 넣기
        </Button>
        <Button type="button" className={OUTLINE} onClick={() => setPanel(panel === 'remove' ? null : 'remove')}>
          박스 빼기
        </Button>
        <BatchLabelPrintButton
          key={selected.id}
          batchId={selected.id}
          prefs={prefs}
          print={print}
          label="송장 일괄 출력"
          outline
          className=""
          disabled={boxPrinting}
          afterPrinted="이제 F1 «출고 검수»에서 송장을 찍으세요."
          autoPrint={autoPrintFor === selected.id}
          onAutoPrintStarted={() => setAutoPrintFor(null)}
          onRunningChange={(running) => {
            if (running)
              writeLastBatch(prefs, { id: selected.id, batchNumber: selected.batchNumber, name: batchNameOf(selected) });
            setBatchPrinting(running);
          }}
        />
        <Button type="button" disabled>
          배치 시작됨
        </Button>
      </>
    )
  ) : null;

  const panels = selected ? (
    <>
      {removedOnStart[selected.id] ? <RemovedOnStartNotice outcome={removedOnStart[selected.id]} /> : null}
      {panel === 'join' ? (
        <JoinBoxPanel batchId={selected.id} prefs={prefs} print={print} labelPrinting onClose={() => setPanel(null)} />
      ) : null}
      {panel === 'remove' ? (
        <RemoveBoxPanel
          batchId={selected.id}
          onClose={() => setPanel(null)}
          onWithdrawing={(shipment) => {
            writeLastBox(prefs, shipment);
            void navigate({ to: '/outbound' });
          }}
        />
      ) : null}
    </>
  ) : null;

  return (
    <Frame today={today}>
      {failure}
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(280px,.8fr)_minmax(480px,1.9fr)] gap-[22px] max-[900px]:flex max-[900px]:flex-col">
        <section aria-label="배치 목록" className={cn(PANEL, 'flex min-h-0 flex-col')}>
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-[#e4e4e7]">
                  <th className={TH}>배치</th>
                  <th className={cn(TH, 'w-24')}>상태</th>
                  <th className={cn(TH, 'w-24 text-right')}>진행</th>
                </tr>
              </thead>
              <tbody>
                {active.map((batch) => (
                  <BatchRow key={batch.id} batch={batch} selected={batch.id === selected?.id} onSelect={() => select(batch.id)} />
                ))}
                {empty.length > 0 && active.length > 0 ? (
                  <tr className="border-b border-[#e4e4e7]">
                    <td colSpan={3} className="px-4 py-2.5">
                      <button type="button" className="text-xs text-[#71717a] hover:text-[#27272a]" onClick={() => setShowEmpty(!showEmpty)}>
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
        {selected ? (
          <BatchDetail
            batch={selected}
            items={items.data}
            warehouseId={warehouseId}
            actions={actions}
            panels={panels}
            openError={openError}
            boxBusy={printing || lookup.isPending}
            onOpenBox={(trackingNo) => void openBox(trackingNo)}
            renderPrint={(shipmentId) => (
              <ReprintLabelButton
                shipmentId={shipmentId}
                prefs={prefs}
                print={print}
                label="출력 확인"
                className={cn(OUTLINE, SMALL)}
                disabled={batchPrinting}
                onRunningChange={setBoxPrinting}
              />
            )}
          />
        ) : null}
      </div>
    </Frame>
  );
}

function batchStateOf(batch: OutboundBatchSummary): { label: string; tone: string } {
  if (isNewBatch(batch)) return { label: '새 배치', tone: PILL_WARN };

  if (batch.startedAt === null) return { label: '빈 배치', tone: PILL_GRAY };

  return { label: '진행 중', tone: PILL_BLUE };
}

function BatchRow({ batch, selected, onSelect }: { batch: OutboundBatchSummary; selected: boolean; onSelect(): void }) {
  const items = useBatchWorkItems(batch.id);
  const progress = items.data ? batchProgressOf(batch.batchNumber, items.data) : null;
  const name = batchNameOf(batch);
  const state = batchStateOf(batch);

  return (
    <tr className={cn('border-b border-[#e4e4e7] last:border-b-0', selected && 'bg-[#eff6ff]')}>
      <td className="px-4 py-3">
        <button type="button" onClick={onSelect} className="font-semibold text-[#27272a] tabular-nums">
          {batch.batchNumber}
        </button>
        {name ? <span className={cn('mt-1 block text-xs', MUTED)}>{name}</span> : null}
      </td>
      <td className="px-4 py-3">
        <span className={cn(PILL, state.tone)}>{state.label}</span>
      </td>
      <td className="px-4 py-3 text-right tabular-nums">
        {progress ? `${progress.done}/${progress.total}` : `0/${batch.totalBoxes ?? batch.totalItems}`}
        {batch.withdrawingItems > 0 ? <span className="mt-1 block text-xs text-[#925e13]">빠지는 중 {batch.withdrawingItems}</span> : null}
      </td>
    </tr>
  );
}

const ROW_PILL: Record<BoxRow['tone'], string> = {
  alert: PILL_RED,
  warn: PILL_WARN,
  work: PILL_BLUE,
  idle: PILL_BLUE,
};

function BatchDetail({
  batch,
  items,
  warehouseId,
  actions,
  panels,
  openError,
  boxBusy,
  onOpenBox,
  renderPrint,
}: {
  batch: OutboundBatchSummary;
  items: BatchWorkItem[] | undefined;
  warehouseId: string;
  actions: ReactNode;
  panels: ReactNode;
  openError: string | null;
  boxBusy: boolean;
  onOpenBox(trackingNo: string): void;
  renderPrint(shipmentId: string): ReactNode;
}) {
  const api = useApiClient();
  // 일괄 인쇄 단추와 같은 키 — 인쇄·넣기·빼기 뒤의 무효화가 여기에도 닿는다
  const states = useQuery({
    queryKey: ['waybill-label-states', batch.id],
    queryFn: () => fetchBatchLabelStates(api, batch.id),
  });
  const refills = usePendingRefills(warehouseId);
  const pending = new Set((refills.data ?? []).map((box) => box.shipmentId));
  const counts = items ? boxCountsOf(items) : null;
  const progress = items ? batchProgressOf(batch.batchNumber, items) : null;
  const labelRows = (states.data ?? []).flatMap((state) => {
    const row = boxRowOf(state);

    return row ? [row] : [];
  });
  const rows = sortBoxRows(withRefillPending(labelRows, pending));
  const attention = items ? boxAttentionOf(items, rows, pending) : null;
  const name = batchNameOf(batch);
  const boxes = progress?.total ?? batch.totalBoxes;
  const sizeText = boxes !== undefined ? `${boxes}상자` : null;
  const subtitle = name ? [batch.batchNumber, sizeText].filter(Boolean).join(' · ') : sizeText;
  const percent = progress && progress.total > 0 ? (progress.done / progress.total) * 100 : 0;

  return (
    <section aria-label="배치 상세" className={cn(PANEL, 'flex min-h-0 flex-col')}>
      <div className={cn(PANEL_HEAD, 'shrink-0 flex-wrap')}>
        <div className="min-w-0">
          <h2 className="text-xl font-bold tracking-[-0.6px] text-[#27272a]">{name ?? batch.batchNumber}</h2>
          {subtitle ? <small className={cn('mt-1 block text-xs', MUTED)}>{subtitle}</small> : null}
        </div>
        <div className="flex flex-wrap items-start justify-end gap-2">{actions}</div>
      </div>
      <div className="flex shrink-0 flex-col gap-3 px-[22px] py-5 empty:hidden">
        {panels}
        {progress && counts && attention ? (
          <div>
            <div className="flex items-center justify-between gap-3 text-[15px] text-[#27272a]">
              <span>
                검수 완료 <span aria-label="완료">{progress.done}</span> / {progress.total}상자
              </span>
              <small className={cn('text-xs', MUTED)}>
                보충 대기 {attention.refill} · 확인 필요 {attention.attention}
              </small>
            </div>
            <div
              role="progressbar"
              aria-label="검수 진행"
              aria-valuemin={0}
              aria-valuemax={progress.total}
              aria-valuenow={progress.done}
              className="mt-5 h-1.5 overflow-hidden rounded-md bg-[#dbeafe]"
            >
              <div className="h-full rounded-md bg-[#2563eb] transition-[width] duration-[250ms]" style={{ width: `${percent}%` }} />
            </div>
            <div className={cn('mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs', MUTED)}>
              <span>
                검수 중 <span aria-label="검수 중">{counts.working}</span>
              </span>
              <span>
                대기 <span aria-label="대기">{counts.waiting}</span>
              </span>
              <span>
                빠지는 중 <span aria-label="빠지는 중">{counts.withdrawing}</span>
              </span>
            </div>
          </div>
        ) : null}
        {counts && counts.withdrawing > 0 ? (
          <p role="status" className={cn(NOTE, 'bg-[#fff1d9] text-[#925e13]')}>
            빠지는 중인 상자는 F1 «출고 검수»에서 송장을 찍고 담은 상품을 꺼내 주세요.
          </p>
        ) : null}
        {hasCancelPending(states.data ?? []) ? (
          <p role="alert" className={cn(NOTE, 'bg-[#fcebe8] text-[#a94035]')}>
            취소 대기 박스는 박스 빼기로 빼야 취소가 끝나요.
          </p>
        ) : null}
        {openError ? (
          <p role="alert" className={cn(NOTE, 'bg-[#fcebe8] text-[#a94035]')}>
            {openError}
          </p>
        ) : null}
      </div>
      {rows.length > 0 ? (
        <ol aria-label="박스" className="min-h-0 flex-1 overflow-auto px-5 [scrollbar-gutter:stable]">
          {/* 스크롤바가 내용 위에 겹치는 웹뷰(리눅스)에서도 오른쪽 단추를 가리지 않게 자리를 잡아 둔다 */}
          {rows.map((row) => (
            <li key={row.shipmentId} className="flex items-center gap-3 border-b border-[#e4e4e7] py-[18px] last:border-b-0">
              <Package className="h-5 w-5 shrink-0 text-[#27272a]" strokeWidth={1.65} aria-hidden />
              <div className="min-w-0 flex-1">
                <strong className="block text-[13px] leading-[1.6] font-semibold tabular-nums">
                  {row.trackingNo ? formatTrackingNo(row.trackingNo) : '송장 없음'}
                </strong>
                {row.recipient ? <small className={cn('mt-1 block text-xs', MUTED)}>{row.recipient}</small> : null}
              </div>
              <span className={cn(PILL, ROW_PILL[row.tone])}>{row.status}</span>
              {row.action === 'print' ? renderPrint(row.shipmentId) : null}
              {row.action === 'open' ? (
                <Button type="button" className={cn(OUTLINE, SMALL)} disabled={boxBusy} onClick={() => onOpenBox(row.trackingNo)}>
                  상자 보기
                </Button>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
