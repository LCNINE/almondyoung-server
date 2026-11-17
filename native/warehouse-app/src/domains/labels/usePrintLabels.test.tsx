import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { createMemoryPrefs } from '../../core/data/devicePrefs';
import { BARCODE_LABEL_PRINTER_KEY } from '../../core/hardware/print/labelPrinter';
import type { LabelBatch } from './labelApi';
import { usePrintLabels } from './usePrintLabels';

const prefs = () => createMemoryPrefs({ [BARCODE_LABEL_PRINTER_KEY]: 'spooler://TX400' });
const batch = (over: Partial<LabelBatch> = {}): LabelBatch => ({
  format: 'zpl',
  data: '^XA^XZ',
  labels: 2,
  skipped: [],
  ...over,
});

describe('usePrintLabels', () => {
  it('라벨 칸이 비면 fetch 를 부르지 않는다', async () => {
    const fetch = vi.fn(async () => batch());
    const { result } = renderHook(() => usePrintLabels(createMemoryPrefs(), vi.fn()));
    await expect(act(() => result.current.run(fetch))).resolves.toEqual({ kind: 'no-printer' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('받은 ZPL 을 라벨 칸 target 으로 보낸다', async () => {
    const print = vi.fn(async () => {});
    const { result } = renderHook(() => usePrintLabels(prefs(), print));
    const r = await act(() => result.current.run(async () => batch()));
    expect(r).toEqual({ kind: 'sent', labels: 2, skipped: [] });
    expect(print).toHaveBeenCalledWith('spooler://TX400', '^XA^XZ');
  });

  it('data 가 비면 보내지 않는다', async () => {
    const print = vi.fn(async () => {});
    const { result } = renderHook(() => usePrintLabels(prefs(), print));
    const r = await act(() => result.current.run(async () => batch({ data: '', labels: 0 })));
    expect(r.kind).toBe('nothing');
    expect(print).not.toHaveBeenCalled();
  });
});
