import type { DevicePrefs } from '../../core/data/devicePrefs';
import type { ApiClient } from '../../core/data/httpClient';
import { NO_PRINTER_MESSAGE, readLabelPrinter, type PrintRaw } from '../../core/hardware/print/labelPrinter';
import {
  confirmLabelPrinted,
  fetchWaybillLabel,
  labelErrorMessage,
  printOneLabel,
} from '../../domains/outbound/waybillLabel';

export type PrintOutcome = { ok: true } | { ok: false; message: string };

/**
 * 박스 한 장 — 지금의 단건 출력 경로(렌더 → 프린터 → 출력 확인, 스펙 §6.2). 송장 바뀜·결품 채움의 자동 출력과 F12 가 쓴다.
 * 프린터가 없으면 보내지 않는다. 프린터 실패는 printRaw 가 상태바에 알린다.
 */
export async function printWaybill(
  deps: { api: ApiClient; print: PrintRaw; prefs: DevicePrefs },
  shipmentId: string
): Promise<PrintOutcome> {
  const target = readLabelPrinter(deps.prefs);
  if (!target) return { ok: false, message: NO_PRINTER_MESSAGE };
  try {
    await printOneLabel(
      {
        fetchLabel: (id) => fetchWaybillLabel(deps.api, id),
        confirm: (id, fingerprint) => confirmLabelPrinted(deps.api, id, fingerprint),
        print: deps.print,
        target,
      },
      shipmentId
    );
    return { ok: true };
  } catch (error) {
    return { ok: false, message: labelErrorMessage(error) };
  }
}
