import { useState } from 'react';
import { ScanBarcode } from 'lucide-react';
import { useWarehouse } from '../../app/warehouse-context';
import { useApiClient } from '../../core/data/ApiClientProvider';
import { localStoragePrefs, type DevicePrefs } from '../../core/data/devicePrefs';
import { errorMessage } from '../../core/data/errorMessage';
import { Button } from '../../core/design/Button';
import { cn } from '../../core/design/cn';
import { ScreenHeader } from '../../core/design/ScreenHeader';
import { isCommandCode } from '../../core/hardware/scan/commandPrefix';
import { useScanEmit, useScanner } from '../../core/hardware/scan/useScanner';
import { Barcode } from '../../station/Barcode';
import { encodeCode128B } from '../../station/code128';
import {
  NO_LABEL_PRINTER_MESSAGE,
  PRINTER_FAILURE_MESSAGE,
  printerNameOf,
  readPrinter,
  printRawLabel,
  type PrintRaw,
} from '../../core/hardware/print/labelPrinter';
import { useLocationSearch } from '../warehouse/useLocationSearch';
import { WarehousePicker } from '../warehouse/WarehousePicker';
import { fetchLocationLabels, skipReasonText, type LabelBatch } from './labelApi';
import { usePrintLabels, type PrintResult } from './usePrintLabels';
import { rackLabelOf, useRackLocations, useRacks } from './useRacks';

type Outcome = { kind: 'result'; result: PrintResult; picked: Picked[] } | { kind: 'error'; text: string };
interface Picked {
  id: string;
  code: string;
}

/**
 * 건너뛴 칸 한 줄 — `코드 — 사유`. core 가 코드를 못 줄 때(찾을 수 없음)는 ref(id)를
 * 고른 칸 목록에서 코드로 되돌리고, 모르는 ref 일 때만 ref 를 그대로 보인다.
 */
function skipLines(skipped: LabelBatch['skipped'], picked: Picked[]): string[] {
  return skipped.map((s) => {
    const code = s.code ?? picked.find((p) => p.id === s.ref)?.code ?? s.ref;
    return `${code} — ${skipReasonText(s.reason, 'location')}`;
  });
}

const PANEL = 'flex min-w-0 flex-col overflow-hidden rounded-xl border border-[#e4e4e7] bg-white';
const PANEL_HEAD =
  'flex min-h-[78px] shrink-0 items-center justify-between gap-2.5 border-b border-[#e4e4e7] px-[22px] py-[19px] max-[700px]:min-h-16';
const MODES = [
  ['rack', '랙 전체'],
  ['picked', '칸 선택'],
] as const;

/** 적치·이동 탭의 «로케이션 라벨» — 랙 전체나 고른 칸의 바코드 라벨을 라벨 프린터로 뽑는다(#1281). */
export function LocationLabelScreen({
  prefs = localStoragePrefs,
  print = printRawLabel,
}: {
  prefs?: DevicePrefs;
  print?: PrintRaw;
}) {
  const api = useApiClient();
  const { warehouseId, warehouseName, isSet } = useWarehouse();
  const emit = useScanEmit();
  const racks = useRacks(warehouseId);
  const { run, busy } = usePrintLabels(prefs, print);
  const [mode, setMode] = useState<'rack' | 'picked'>('rack');
  const [rackId, setRackId] = useState('');
  const [term, setTerm] = useState('');
  const [picked, setPicked] = useState<Picked[]>([]);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const found = useLocationSearch(warehouseId, term, 'putaway-destination');
  const rack = (racks.data ?? []).find((r) => r.id === rackId);
  const rackLocations = useRackLocations(warehouseId, rack);
  const [draft, setDraft] = useState('');
  const printerTarget = readPrinter(prefs, 'label');
  const printerName = printerTarget ? printerNameOf(printerTarget) : '설정 필요';
  const sortedPicked = [...picked].sort((a, b) => a.code.localeCompare(b.code));
  const previewCodes = mode === 'rack' ? (rackLocations.data?.codes ?? []) : sortedPicked.map((x) => x.code);
  const total = mode === 'rack' ? (rackLocations.data?.total ?? 0) : picked.length;
  const truncated = mode === 'rack' && total > previewCodes.length;
  const rackReady = rack !== undefined && rackLocations.isSuccess && rackLocations.data.total > 0;
  const rackLoading = mode === 'rack' && rack !== undefined && rackLocations.isPending;
  const rackEmpty = mode === 'rack' && rack !== undefined && rackLocations.isSuccess && rackLocations.data.total === 0;
  const canPrint = mode === 'rack' ? rackReady : picked.length > 0;

  // 스캔은 포커스가 어디 있든 검색어가 된다 — 명령 바코드는 셸이 가져가 여기 오지 않는다.
  useScanner((e) => {
    setMode('picked');
    setTerm(e.code.trim());
  });

  const add = (item: Picked) =>
    setPicked((prev) => (prev.some((p) => p.id === item.id) ? prev : [...prev, item]));

  const send = async (body: { rackId: string } | { locationIds: string[] }) => {
    const pickedAtSend = picked;
    try {
      const result = await run(() => fetchLocationLabels(api, body));
      if (result.kind === 'ignored') return;
      setOutcome({ kind: 'result', result, picked: pickedAtSend });
    } catch (error) {
      setOutcome({ kind: 'error', text: errorMessage(error) });
    }
  };

  const submitDraft = () => {
    const value = draft.trim();
    if (value === '') return;
    setDraft('');
    if (isCommandCode(value)) {
      emit({ code: value, source: 'hid', at: Date.now() });
      return;
    }

    setTerm(value);
  };

  const printCurrent = () => (mode === 'rack' ? send({ rackId }) : send({ locationIds: picked.map((p) => p.id) }));

  if (!isSet) {
    return (
      <div className="space-y-3">
        <ScreenHeader title="로케이션 라벨" backTo="/" />
        <p className="text-sm text-[#71717a]">창고를 먼저 선택하세요.</p>
        <WarehousePicker />
      </div>
    );
  }

  return (
    <div className="space-y-[22px] max-[700px]:space-y-[18px]">
      <ScreenHeader
        title="로케이션 라벨"
        backTo="/"
        description="랙 전체 또는 필요한 칸을 골라 라벨을 출력하세요."
        right={<span className="text-xs text-[#71717a]">{`라벨 프린터 · ${printerName}`}</span>}
      />

      <div className="grid shrink-0 grid-cols-[minmax(280px,0.9fr)_minmax(400px,1.2fr)] items-stretch gap-6 max-[1000px]:grid-cols-2 max-[1000px]:gap-[18px] max-[700px]:grid-cols-1 max-[700px]:gap-[18px]">
        <section aria-label="출력 대상" className={PANEL}>
          <div className={PANEL_HEAD}>
            <div role="group" aria-label="출력 방식" className="flex gap-0.5 rounded-lg bg-[#ededee] p-1">
              {MODES.map(([value, text]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={mode === value}
                  onClick={() => setMode(value)}
                  className={cn(
                    'rounded-[5px] px-3.5 py-[7px] text-[13px] whitespace-nowrap text-[#71717a]',
                    mode === value && 'bg-white font-semibold text-[#27272a] shadow-[0_1px_3px_#0000000c]'
                  )}
                >
                  {text}
                </button>
              ))}
            </div>
          </div>

          <div className="px-[22px] py-5">
            {mode === 'rack' ? (
              racks.isError ? (
                <p role="alert" className="text-[13px] text-[#aa4037]">
                  {errorMessage(racks.error)}
                </p>
              ) : (
                <>
                  <label className="flex flex-col gap-2 text-[13px] text-[#27272a]">
                    출력할 랙
                    <select
                      className="w-full rounded-lg border border-[#e4e4e7] bg-white px-3 py-2.5 text-[13px]"
                      value={rackId}
                      onChange={(e) => setRackId(e.target.value)}
                    >
                      <option value="">랙을 고르세요</option>
                      {(racks.data ?? []).map((r) => (
                        <option key={r.id} value={r.id}>
                          {rackLabelOf(r)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="mt-[9px] text-[11px] leading-[1.7] text-[#71717a]">
                    현재 창고의 사용 중인 랙 목록입니다.
                    <br />
                    선택한 랙에 속한 모든 칸을 한 장씩 출력합니다.
                  </p>
                  {(rackLocations.data?.codes ?? []).length > 0 ? (
                    <ul className="mt-6 max-h-[330px] overflow-auto border-t border-[#e4e4e7]">
                      {(rackLocations.data?.codes ?? []).map((code) => (
                        <li
                          key={code}
                          className="flex justify-between border-b border-[#e4e4e7] py-[15px] text-[13px]"
                        >
                          <strong className="font-medium">{code}</strong>
                          <span className="text-xs text-[#71717a]">1장</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </>
              )
            ) : (
              <>
                <form
                  className="flex items-center gap-1.5 rounded-[10px] border border-[#e4e4e7] bg-white p-[9px]"
                  onSubmit={(e) => {
                    e.preventDefault();
                    submitDraft();
                  }}
                >
                  <ScanBarcode className="h-[17px] w-[17px] shrink-0 text-[#2563eb]" aria-hidden />
                  <input
                    aria-label="로케이션 코드"
                    className="w-full flex-1 border-0 bg-transparent p-1 text-xs outline-0"
                    placeholder="위치 코드 검색 또는 스캔"
                    autoComplete="off"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                  />
                  <Button type="submit" className="px-3 py-1.5 text-[11px]" disabled={draft.trim() === ''}>
                    검색
                  </Button>
                </form>

                {found.isError ? (
                  <p role="alert" className="mt-[13px] text-xs leading-[1.7] text-[#aa4037]">
                    {errorMessage(found.error)}
                  </p>
                ) : term !== '' && found.data && found.data.items.length === 0 ? (
                  <p className="mt-[9px] text-[11px] leading-[1.7] text-[#71717a]">찾은 칸이 없어요.</p>
                ) : (
                  <ul className="mt-[17px] flex max-h-[230px] flex-col overflow-auto border-t border-[#e4e4e7]">
                    {(found.data?.items ?? []).map((item) => {
                      const already = picked.some((p) => p.id === item.id);

                      return (
                        <li key={item.id} className="border-b border-[#e4e4e7]">
                          <button
                            type="button"
                            aria-label={`${item.code} 고르기`}
                            disabled={already}
                            className="flex w-full items-center justify-between gap-3 px-1 py-3.5 text-left text-xs hover:bg-[#fafafa] disabled:opacity-60"
                            onClick={() => add({ id: item.id, code: item.code })}
                          >
                            <strong className="font-[550] text-[#27272a]">{item.code}</strong>
                            <span className="text-[11px] text-[#71717a]">{already ? '선택됨' : '+ 추가'}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}

                <h3 className="mt-6 mb-3 text-[13px] font-semibold text-[#27272a]">{`고른 칸 ${picked.length}개`}</h3>
                <div className="flex flex-wrap gap-2">
                  {sortedPicked.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      aria-label={`${p.code} 빼기`}
                      className="rounded-[5px] border border-[#e4e4e7] bg-[#fafafa] px-2.5 py-2 text-xs"
                      onClick={() => setPicked((prev) => prev.filter((x) => x.id !== p.id))}
                    >
                      {p.code} <span className="ml-2 text-[#71717a]">×</span>
                    </button>
                  ))}
                  {picked.length === 0 ? <small className="text-[#71717a]">출력할 칸을 추가하세요.</small> : null}
                </div>
              </>
            )}
          </div>
        </section>

        <section aria-label="출력 미리보기" className={PANEL}>
          <div className={PANEL_HEAD}>
            <h3 className="text-base font-semibold text-[#27272a]">출력 미리보기</h3>
            <span className="text-[15px] font-[650] tabular-nums">{`${total}장`}</span>
          </div>

          {mode === 'rack' && rackLocations.isError ? (
            <div className="grid flex-1 place-items-center px-6 py-[65px] text-center">
              <p role="alert" className="text-[13px] text-[#aa4037]">
                {errorMessage(rackLocations.error)}
              </p>
            </div>
          ) : rackLoading ? (
            <div role="status" className="grid flex-1 place-items-center px-6 py-[65px] text-center text-[13px] text-[#71717a]">
              랙의 칸을 불러오고 있어요.
            </div>
          ) : rackEmpty ? (
            <div className="grid flex-1 place-items-center px-6 py-[65px] text-center text-[13px] text-[#71717a]">
              이 랙에는 출력할 칸이 없어요.
            </div>
          ) : previewCodes.length > 0 ? (
            <ul className="grid max-h-[330px] grid-cols-2 gap-2.5 overflow-auto bg-[#f4f4f5] p-4 max-[700px]:grid-cols-1">
              {previewCodes.map((code) => (
                <li
                  key={code}
                  className="rounded border border-[#d4d4d8] bg-white px-2 py-3.5 text-center text-[#27272a]"
                >
                  <strong className="text-xl tracking-[0.4px] whitespace-nowrap">{code}</strong>
                  <div className="mx-auto mt-3 mb-1.5 max-w-[180px]">
                    <CodeBars code={code} />
                  </div>
                  <span className="text-[10px] text-[#71717a]">{warehouseName}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="grid flex-1 place-items-center px-6 py-[65px] text-center text-[13px] text-[#71717a]">
              왼쪽에서 랙이나 로케이션을 선택하세요.
            </div>
          )}

          {truncated ? (
            <p className="px-[22px] py-2.5 text-[11px] text-[#71717a]">
              {`전체 ${total}칸 중 ${previewCodes.length}칸 미리보기`}
            </p>
          ) : null}

          <div className="mt-auto border-t border-[#e4e4e7] p-[22px]">
            <div className="mb-[17px] flex items-center justify-between text-[13px]">
              <span className="text-[#71717a]">
                {mode === 'rack' ? (rack ? `${rackLabelOf(rack)} 랙` : '랙 선택 전') : '선택한 로케이션'}
              </span>
              <strong className="tabular-nums">{`총 ${total}장`}</strong>
            </div>
            <Button type="button" className="w-full py-2.5" disabled={busy || !canPrint} onClick={printCurrent}>
              {mode === 'rack' ? '랙 전체 출력' : '고른 칸 출력'}
            </Button>
            <p className="mt-3 text-center text-[11px] text-[#71717a]">코드 순서로 나와요</p>
          </div>
        </section>
      </div>

      {outcome ? <OutcomeText outcome={outcome} /> : null}
    </div>
  );
}

function CodeBars({ code }: { code: string }) {
  try {
    return <Barcode bits={encodeCode128B(code)} label={`${code} 바코드`} height={36} fluid />;
  } catch {
    return null;
  }
}

function SkipList({ skipped, picked }: { skipped: LabelBatch['skipped']; picked: Picked[] }) {
  return (
    <ul>
      {skipLines(skipped, picked).map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  );
}

function OutcomeText({ outcome }: { outcome: Outcome }) {
  if (outcome.kind === 'error')
    return (
      <p role="alert" className="text-[13px] text-[#aa4037]">
        {outcome.text}
      </p>
    );
  const r = outcome.result;
  switch (r.kind) {
    case 'ignored':
      return null;
    case 'no-printer':
      return (
        <p role="alert" className="text-[13px] text-[#aa4037]">
          {NO_LABEL_PRINTER_MESSAGE}
        </p>
      );
    case 'printer-error':
      return (
        <p role="alert" className="text-[13px] text-[#aa4037]">
          {PRINTER_FAILURE_MESSAGE}
          <span className="block text-xs text-[#71717a]">{r.detail}</span>
        </p>
      );
    case 'nothing':
      return (
        <div role="alert" className="text-[13px] text-[#aa4037]">
          {r.skipped.length ? <SkipList skipped={r.skipped} picked={outcome.picked} /> : <p>찍을 라벨이 없어요</p>}
        </div>
      );
    case 'sent':
      return (
        <div role="status" className="text-[13px] text-[#27272a]">
          <p>{`라벨 ${r.labels}장을 보냈어요`}</p>
          {r.skipped.length ? (
            <div className="text-[#9a681c]">
              <SkipList skipped={r.skipped} picked={outcome.picked} />
            </div>
          ) : null}
        </div>
      );
  }
}
