import { useRef, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { cn } from '../../design/cn';
import { localStoragePrefs, type DevicePrefs } from '../../data/devicePrefs';
import { renderTestLabel, renderTestLabel50x30 } from './zpl';
import {
  NO_LABEL_PRINTER_MESSAGE,
  NO_PRINTER_MESSAGE,
  PRINTER_FAILURE_MESSAGE,
  PrinterError,
  printRaw,
  printRawLabel,
  printerNameOf,
  readPrinter,
  writePrinter,
  type PrintRaw,
  type PrinterSlot,
} from './labelPrinter';

type Status = { kind: 'ok' | 'error'; text: string; detail?: string };

const TITLE: Record<PrinterSlot, string> = { waybill: '송장 프린터', label: '라벨 프린터' };
const HELP: Record<PrinterSlot, string> = {
  waybill: '택배 송장을 출력합니다.',
  label: '상품·로케이션 바코드를 출력합니다.',
};
const EMPTY_MESSAGE: Record<PrinterSlot, string> = {
  waybill: NO_PRINTER_MESSAGE,
  label: NO_LABEL_PRINTER_MESSAGE,
};

/** 칸(송장·라벨)마다 이 PC 에 물린 프린터의 Windows 이름을 받는다. */
export function PrinterSettings({
  slot,
  prefs = localStoragePrefs,
  print = slot === 'label' ? printRawLabel : printRaw,
}: {
  slot: PrinterSlot;
  prefs?: DevicePrefs;
  print?: PrintRaw;
}) {
  const title = TITLE[slot];
  const [name, setName] = useState(() => printerNameOf(readPrinter(prefs, slot) ?? ''));
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  // state 는 다음 렌더에야 보인다 — 같은 틱의 연타는 ref 로 막아야 테스트 라벨이 두 장 안 나온다.
  const running = useRef(false);

  const save = (): string | null => {
    writePrinter(prefs, slot, name);
    const saved = readPrinter(prefs, slot);
    setName(printerNameOf(saved ?? ''));
    return saved;
  };

  const testPrint = async () => {
    if (running.current) return;
    // 입력만 하고 저장을 안 누른 채 시험하는 게 자연스러워서, 시험 전에 저장한다.
    const target = save();
    if (!target) {
      setStatus({ kind: 'error', text: EMPTY_MESSAGE[slot] });
      return;
    }
    running.current = true;
    setBusy(true);
    try {
      await print(
        target,
        slot === 'label'
          ? renderTestLabel50x30()
          : renderTestLabel({ title: 'ALMOND WMS', barcode: '8801234' }),
      );
      setStatus({ kind: 'ok', text: `${title} 로 테스트를 보냈어요. 프린터에서 나왔는지 확인해 주세요.` });
    } catch (error) {
      setStatus({
        kind: 'error',
        text: PRINTER_FAILURE_MESSAGE,
        detail: error instanceof PrinterError ? error.detail : String(error),
      });
    } finally {
      running.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-start gap-2 border-t border-[#e4e4e7] py-[18px] first:border-t-0 first:pt-0 last:pb-0 min-[1331px]:flex-row min-[1331px]:items-center min-[1331px]:justify-between min-[1331px]:gap-4 [@media(min-width:901px)_and_(max-height:850px)]:flex-row [@media(min-width:901px)_and_(max-height:850px)]:items-center [@media(min-width:901px)_and_(max-height:850px)]:justify-between [@media(min-width:901px)_and_(max-height:850px)]:gap-4 [@media(min-width:901px)_and_(max-height:850px)]:py-3">
      <div>
        <h3 className="text-[13px] font-semibold text-[#27272a]">{title}</h3>
        <p className="mt-1 text-xs text-[#71717a]">{HELP[slot]}</p>
      </div>
      <form
        className="flex w-full shrink-0 flex-wrap items-center gap-2 min-[1331px]:w-[280px] [@media(min-width:901px)_and_(max-height:850px)]:w-[280px]"
        onSubmit={(e) => {
          e.preventDefault();
          const saved = save();
          setStatus({ kind: 'ok', text: saved ? '저장했어요.' : `${title} 설정을 지웠어요.` });
        }}
      >
        <input
          className="w-[210px] max-w-full rounded-lg border border-[#e4e4e7] bg-white px-[11px] py-[9px] text-[13px] text-[#27272a] placeholder:text-[#a1a1aa]"
          aria-label={`${title} 이름`}
          placeholder={slot === 'label' ? '예: TX400' : '예: XP-DT108B'}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button
          type="submit"
          aria-label={`${title} 저장`}
          className="rounded-lg border border-[#e4e4e7] bg-white px-3.5 py-2 text-xs font-semibold text-[#27272a] hover:bg-[#f4f4f5]"
        >
          저장
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 px-1 py-[7px] text-xs font-medium text-[#2563eb] disabled:pointer-events-none disabled:opacity-40"
          aria-label={`${title} 테스트 인쇄`}
          disabled={busy}
          onClick={() => void testPrint()}
        >
          테스트 인쇄
          <ArrowRight className="h-[13px] w-[13px]" aria-hidden />
        </button>
      </form>
      {status && (
        <p
          role={status.kind === 'error' ? 'alert' : 'status'}
          className={cn('text-sm', status.kind === 'error' ? 'text-[#aa4037]' : 'text-[#27272a]')}
        >
          {status.text}
          {status.detail && <span className="block text-xs text-[#71717a]">{status.detail}</span>}
        </p>
      )}
    </div>
  );
}
