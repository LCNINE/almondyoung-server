import { describe, expect, it, vi } from 'vitest';
import { createMemoryPrefs } from '../../core/data/devicePrefs';
import {
  LABEL_PRINTER_KEY,
  NO_PRINTER_MESSAGE,
  PRINTER_FAILURE_MESSAGE,
  PrinterError,
} from '../../core/hardware/print/labelPrinter';
import { printWaybill } from './printWaybill';

function fakeApi(calls: string[]) {
  return {
    request: vi.fn(async (o: { method?: string; path: string }) => {
      calls.push(`${o.method ?? 'GET'} ${o.path}`);
      if (o.path.endsWith('/waybill/label'))
        return { waybillId: 'wb', trackingNo: 'T', format: 'zpl', data: '^XA^XZ', fingerprint: 'fp', revision: 1 };
      return {};
    }),
  };
}
const withPrinter = () => createMemoryPrefs({ [LABEL_PRINTER_KEY]: 'spooler://XP' });

describe('printWaybill — 지금의 단건 출력 경로(스펙 §6.2)', () => {
  it('프린터가 없으면 아무것도 보내지 않는다', async () => {
    const calls: string[] = [];
    const print = vi.fn();
    expect(await printWaybill({ api: fakeApi(calls) as never, print, prefs: createMemoryPrefs() }, 's-1')).toEqual({
      ok: false,
      message: NO_PRINTER_MESSAGE,
    });
    expect(calls).toEqual([]);
    expect(print).not.toHaveBeenCalled();
  });

  it('렌더 → 프린터 → 출력 확인', async () => {
    const calls: string[] = [];
    const print = vi.fn(async () => {});
    expect(await printWaybill({ api: fakeApi(calls) as never, print, prefs: withPrinter() }, 's-1')).toEqual({ ok: true });
    expect(print).toHaveBeenCalledWith('spooler://XP', '^XA^XZ');
    expect(calls).toEqual(['GET /shipments/s-1/waybill/label', 'POST /shipments/s-1/waybill/label-prints']);
  });

  it('프린터로 못 보내면 프린터 문구', async () => {
    const print = vi.fn(async () => {
      throw new PrinterError('offline');
    });
    expect(await printWaybill({ api: fakeApi([]) as never, print, prefs: withPrinter() }, 's-1')).toEqual({
      ok: false,
      message: PRINTER_FAILURE_MESSAGE,
    });
  });
});
