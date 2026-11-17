import { useState } from 'react';
import { useApiClient } from '../../core/data/ApiClientProvider';
import { localStoragePrefs, type DevicePrefs } from '../../core/data/devicePrefs';
import { errorMessage } from '../../core/data/errorMessage';
import { Button } from '../../core/design/Button';
import {
  NO_LABEL_PRINTER_MESSAGE,
  PRINTER_FAILURE_MESSAGE,
  printRawLabel,
  type PrintRaw,
} from '../../core/hardware/print/labelPrinter';
import { useSkuDetail } from '../inventory/useSkuDetail';
import { fetchSkuLabels, SKIP_REASON_TEXT, type LabelBatch, type SkuLabelSize } from './labelApi';
import { SKU_LABEL_SIZE_KEY, usePrintLabels, type PrintResult } from './usePrintLabels';

const SIZES: { value: SkuLabelSize; text: string }[] = [
  { value: '30x10', text: '1×3' },
  { value: '50x30', text: '3×5' },
];
const MAX_COPIES = 200;

function readSize(prefs: DevicePrefs): SkuLabelSize {
  return prefs.get(SKU_LABEL_SIZE_KEY) === '30x10' ? '30x10' : '50x30';
}

function skipText(skipped: LabelBatch['skipped']): string {
  return skipped.map((s) => SKIP_REASON_TEXT[s.reason]).join(' · ');
}

type Outcome = { kind: 'result'; result: PrintResult } | { kind: 'error'; text: string };

/** SKU 상세의 «라벨 출력» — 크기·장수를 골라 core 가 만든 ZPL 을 라벨 프린터로 보낸다(#1281). */
export function SkuLabelPrintPanel({
  skuId,
  prefs = localStoragePrefs,
  print = printRawLabel,
}: {
  skuId: string;
  prefs?: DevicePrefs;
  print?: PrintRaw;
}) {
  const api = useApiClient();
  const detail = useSkuDetail(skuId);
  const { run, busy } = usePrintLabels(prefs, print);
  const [size, setSize] = useState<SkuLabelSize>(() => readSize(prefs));
  const [copies, setCopies] = useState('1');
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const barcodes = detail.data?.barcodes ?? [];
  const shown = (barcodes.find((b) => b.isPrimary) ?? barcodes[0])?.barcode;
  const count = Number(copies);
  const validCopies = Number.isInteger(count) && count >= 1 && count <= MAX_COPIES;

  const pick = (next: SkuLabelSize) => {
    setSize(next);
    prefs.set(SKU_LABEL_SIZE_KEY, next);
  };

  const submit = async () => {
    if (!validCopies) return;
    try {
      const result = await run(() =>
        fetchSkuLabels(api, { size, items: [{ skuId, copies: count }] }),
      );
      if (result.kind === 'ignored') return;
      setOutcome({ kind: 'result', result });
    } catch (error) {
      setOutcome({ kind: 'error', text: errorMessage(error) });
    }
  };

  return (
    <section className="space-y-2" aria-label="라벨 출력">
      <h2 className="text-sm font-semibold text-gray-700">라벨 출력</h2>
      <p className="text-sm text-gray-600">
        찍힐 바코드{' '}
        {shown ? (
          <span className="font-mono">{shown}</span>
        ) : (
          <span className="text-gray-500">등록된 바코드가 없어요</span>
        )}
      </p>
      <div className="flex items-center gap-2" role="group" aria-label="라벨 크기">
        {SIZES.map((s) => (
          <button
            key={s.value}
            type="button"
            aria-pressed={size === s.value}
            onClick={() => pick(s.value)}
            className={`rounded border px-3 py-1.5 text-sm ${
              size === s.value ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-300 bg-white text-gray-700'
            }`}
          >
            {s.text}
          </button>
        ))}
        <label className="ml-auto flex items-center gap-1 text-sm text-gray-700">
          장수
          <input
            type="number"
            min={1}
            max={MAX_COPIES}
            inputMode="numeric"
            className="w-20 rounded border px-2 py-1.5"
            value={copies}
            onChange={(e) => setCopies(e.target.value)}
          />
        </label>
      </div>
      <Button type="button" className="w-full py-2.5" disabled={busy || !validCopies} onClick={submit}>
        라벨 출력
      </Button>
      {outcome ? <OutcomeText outcome={outcome} /> : null}
    </section>
  );
}

function OutcomeText({ outcome }: { outcome: Outcome }) {
  if (outcome.kind === 'error')
    return (
      <p role="alert" className="text-sm text-red-600">
        {outcome.text}
      </p>
    );
  const r = outcome.result;
  switch (r.kind) {
    case 'ignored':
      return null;
    case 'no-printer':
      return (
        <p role="alert" className="text-sm text-red-600">
          {NO_LABEL_PRINTER_MESSAGE}
        </p>
      );
    case 'printer-error':
      return (
        <p role="alert" className="text-sm text-red-600">
          {PRINTER_FAILURE_MESSAGE}
          <span className="block text-xs text-gray-500">{r.detail}</span>
        </p>
      );
    case 'nothing':
      return (
        <p role="alert" className="text-sm text-red-600">
          {r.skipped.length ? skipText(r.skipped) : '찍을 라벨이 없어요'}
        </p>
      );
    case 'sent':
      return (
        <div role="status" className="text-sm text-gray-700">
          <p>{`라벨 ${r.labels}장을 보냈어요`}</p>
          {r.skipped.length ? <p className="text-amber-700">{skipText(r.skipped)}</p> : null}
        </div>
      );
  }
}
