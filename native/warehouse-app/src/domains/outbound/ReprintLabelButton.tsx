import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '../../core/design/Button';
import { useApiClient } from '../../core/data/ApiClientProvider';
import { useUnsavedWork } from '../../core/operations/useUnsavedWork';
import { localStoragePrefs, type DevicePrefs } from '../../core/data/devicePrefs';
import {
  NO_PRINTER_MESSAGE,
  PrinterError,
  printRaw,
  readLabelPrinter,
  type PrintRaw,
} from '../../core/hardware/print/labelPrinter';
import { confirmLabelPrinted, fetchWaybillLabel, labelErrorMessage, printOneLabel } from './waybillLabel';

type Status = { kind: 'ok' | 'error'; text: string; detail?: string };

/** 박스 한 개의 운송장을 다시 찍는다 — 훼손·분실 대비(#913). 라벨 API 는 부작용이 없고 출력 확인(label-prints)만 기록한다. */
export function ReprintLabelButton({
  shipmentId,
  prefs = localStoragePrefs,
  print = printRaw,
  label = '송장 재출력',
  className = 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50',
  disabled = false,
  lock,
  holdScreen = false,
}: {
  shipmentId: string;
  prefs?: DevicePrefs;
  print?: PrintRaw;
  label?: string;
  className?: string;
  disabled?: boolean;
  lock?: { acquire(): boolean; release(): void };
  holdScreen?: boolean;
}) {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  // state 는 다음 렌더에야 보인다 — 같은 틱의 연타는 ref 로 막아야 같은 번호 라벨이 두 장 안 나온다.
  const running = useRef(false);
  useUnsavedWork(holdScreen && busy);

  const run = async () => {
    if (running.current || disabled) return;
    const target = readLabelPrinter(prefs);
    if (!target) {
      setStatus({ kind: 'error', text: NO_PRINTER_MESSAGE });
      return;
    }
    if (lock && !lock.acquire()) return;
    running.current = true;
    setBusy(true);
    setStatus(null);
    try {
      const label = await printOneLabel(
        {
          fetchLabel: (id) => fetchWaybillLabel(api, id),
          confirm: (id, fingerprint) => confirmLabelPrinted(api, id, fingerprint),
          print,
          target,
        },
        shipmentId
      );
      setStatus({ kind: 'ok', text: `송장을 다시 인쇄했어요 (${label.trackingNo}${label.revision >= 2 ? ` · ${label.revision}판` : ''}).` });
    } catch (error) {
      setStatus({
        kind: 'error',
        text: labelErrorMessage(error),
        detail: error instanceof PrinterError ? error.detail : undefined,
      });
    } finally {
      running.current = false;
      setBusy(false);
      lock?.release();
      void queryClient.invalidateQueries({ queryKey: ['waybill-label-states'] });
    }
  };

  return (
    <div className="space-y-1">
      <Button type="button" className={className} disabled={busy || disabled} onClick={() => void run()}>
        {label}
      </Button>
      {status && (
        <p role={status.kind === 'error' ? 'alert' : 'status'} className="text-sm">
          {status.text}
          {status.detail && <span className="block text-xs text-gray-500">{status.detail}</span>}
        </p>
      )}
    </div>
  );
}
