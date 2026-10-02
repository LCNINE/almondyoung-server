import { useEffect, useState, useSyncExternalStore } from 'react';
import { cn } from '../../core/design/cn';
import { localStoragePrefs, type DevicePrefs } from '../../core/data/devicePrefs';
import { currentServerReach, subscribeServerReach } from '../../core/data/serverStatus';
import { readLabelPrinter } from '../../core/hardware/print/labelPrinter';
import { lastPrintFailed, printerStatusVersion, subscribePrintOutcome } from '../../core/hardware/print/printerStatus';
import { useWorkRuntime } from '../../core/operations/OperationContext';
import type { StoredOperation } from '../../core/operations/operationStore';
import type { TabKey } from '../keys';
import { useCurrentBatchProgress } from './batchProgress';
import { statusBarItems, unsentCount, type StatusTone } from './statusBar';

const NO_OPERATIONS: StoredOperation[] = [];
const noSubscribe = () => () => {};
const noOperations = () => NO_OPERATIONS;

function useUnsentCount(): number {
  const runner = useWorkRuntime()?.runner;
  const operations = useSyncExternalStore(runner?.subscribe ?? noSubscribe, runner?.getSnapshot ?? noOperations);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (operations.length === 0) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [operations]);
  return unsentCount(operations, now);
}

const DOT: Record<StatusTone, string> = {
  ok: 'bg-[#1E7A46]',
  bad: 'bg-[#C62828]',
  warn: 'bg-[#D99A00]',
  idle: 'bg-[#9AA0AC]',
};

/** 상태바 28px(스펙 §5.5). */
export function StatusBar({ tab, prefs = localStoragePrefs }: { tab: TabKey | null; prefs?: DevicePrefs }) {
  // 판수가 오를 때마다 다시 그려 프린터 설정 여부(prefs)와 마지막 실패를 함께 다시 읽는다
  useSyncExternalStore(subscribePrintOutcome, printerStatusVersion);
  const printFailed = lastPrintFailed();
  const server = useSyncExternalStore(subscribeServerReach, currentServerReach);
  const unsent = useUnsentCount();
  const batch = useCurrentBatchProgress();
  const items = statusBarItems({
    printer: { configured: readLabelPrinter(prefs) !== null, lastFailed: printFailed },
    server,
    unsent,
    batch,
    tab,
  });
  return (
    <footer
      aria-label="상태"
      className="flex h-7 shrink-0 items-center gap-[18px] bg-[#E2E4E8] px-4 text-[13px] text-[#3F4450] print:hidden"
    >
      {items.map((item) =>
        item.id === 'batch' ? (
          <span key={item.id} className="ml-auto font-mono font-semibold">
            {item.label}
          </span>
        ) : item.id === 'unsent' ? (
          <span key={item.id} data-tone={item.tone} className="rounded bg-[#FFF1C7] px-2 font-semibold text-[#5E3B00]">
            {item.label}
          </span>
        ) : (
          <span key={item.id} data-tone={item.tone} className="flex items-center gap-1.5">
            <span aria-hidden className={cn('h-2 w-2 rounded-full', DOT[item.tone])} />
            {item.label}
          </span>
        )
      )}
    </footer>
  );
}
