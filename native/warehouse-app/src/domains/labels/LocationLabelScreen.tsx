import { useState, type FormEvent } from 'react';
import { useWarehouse } from '../../app/warehouse-context';
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
import { useLocationSearch } from '../warehouse/useLocationSearch';
import { WarehousePicker } from '../warehouse/WarehousePicker';
import { fetchLocationLabels, SKIP_REASON_TEXT, type LabelBatch } from './labelApi';
import { usePrintLabels, type PrintResult } from './usePrintLabels';
import { rackLabelOf, useRacks } from './useRacks';

type Outcome = { kind: 'result'; result: PrintResult } | { kind: 'error'; text: string };
interface Picked {
  id: string;
  code: string;
}

/** 건너뛴 칸 한 줄 — 코드가 있으면 `코드 — 사유`, 없으면 ref. */
function skipLines(skipped: LabelBatch['skipped']): string[] {
  return skipped.map((s) => `${s.code ?? s.ref} — ${SKIP_REASON_TEXT[s.reason]}`);
}

/** 적치·이동 탭의 «로케이션 라벨» — 랙 전체나 고른 칸의 바코드 라벨을 라벨 프린터로 뽑는다(#1281). */
export function LocationLabelScreen({
  prefs = localStoragePrefs,
  print = printRawLabel,
}: {
  prefs?: DevicePrefs;
  print?: PrintRaw;
}) {
  const api = useApiClient();
  const { warehouseId, isSet } = useWarehouse();
  const racks = useRacks(warehouseId);
  const { run, busy } = usePrintLabels(prefs, print);
  const [rackId, setRackId] = useState('');
  const [input, setInput] = useState('');
  const [term, setTerm] = useState('');
  const [picked, setPicked] = useState<Picked[]>([]);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const found = useLocationSearch(warehouseId, term, 'lookup');

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    setTerm(input.trim());
    setInput('');
  };

  const add = (item: Picked) =>
    setPicked((prev) => (prev.some((p) => p.id === item.id) ? prev : [...prev, item]));

  const send = async (body: { rackId: string } | { locationIds: string[] }) => {
    try {
      const result = await run(() => fetchLocationLabels(api, body));
      if (result.kind === 'ignored') return;
      setOutcome({ kind: 'result', result });
    } catch (error) {
      setOutcome({ kind: 'error', text: errorMessage(error) });
    }
  };

  if (!isSet) {
    return (
      <div className="space-y-3">
        <h1 className="text-lg font-semibold text-gray-800">로케이션 라벨</h1>
        <p className="text-sm text-gray-600">창고를 먼저 선택하세요.</p>
        <WarehousePicker />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-gray-800">로케이션 라벨</h1>

      <section className="space-y-2" aria-label="랙으로 뽑기">
        <h2 className="text-sm font-semibold text-gray-700">랙으로 뽑기</h2>
        {racks.isError ? (
          <p role="alert" className="text-sm text-red-600">
            {errorMessage(racks.error)}
          </p>
        ) : (
          <label className="block text-sm text-gray-700">
            랙
            <select
              className="mt-1 block w-full rounded border px-2 py-2"
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
        )}
        <Button
          type="button"
          className="w-full py-2.5"
          disabled={busy || rackId === ''}
          onClick={() => send({ rackId })}
        >
          랙 전체 출력
        </Button>
      </section>

      <section className="space-y-2" aria-label="칸으로 뽑기">
        <h2 className="text-sm font-semibold text-gray-700">칸으로 뽑기</h2>
        <form onSubmit={submitSearch} className="flex gap-2">
          <input
            aria-label="로케이션 코드"
            className="min-w-0 flex-1 rounded border px-2 py-2"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="스캔하거나 입력하세요"
          />
          <Button type="submit" disabled={input.trim() === ''}>
            찾기
          </Button>
        </form>
        {found.isError ? (
          <p role="alert" className="text-sm text-red-600">
            {errorMessage(found.error)}
          </p>
        ) : term !== '' && found.data && found.data.items.length === 0 ? (
          <p className="text-sm text-gray-500">찾은 칸이 없어요.</p>
        ) : (
          <ul className="space-y-1">
            {(found.data?.items ?? []).map((item) => (
              <li key={item.id} className="flex items-center justify-between rounded border px-2 py-1.5">
                <span className="font-mono text-sm">{item.code}</span>
                <button
                  type="button"
                  aria-label={`${item.code} 담기`}
                  className="rounded border px-3 py-1 text-sm"
                  onClick={() => add({ id: item.id, code: item.code })}
                >
                  담기
                </button>
              </li>
            ))}
          </ul>
        )}

        <h3 className="text-sm font-semibold text-gray-700">{`담은 칸 ${picked.length}개`}</h3>
        <ul className="space-y-1">
          {picked.map((p) => (
            <li key={p.id} className="flex items-center justify-between rounded border px-2 py-1.5">
              <span className="font-mono text-sm">{p.code}</span>
              <button
                type="button"
                aria-label={`${p.code} 빼기`}
                className="rounded border px-3 py-1 text-sm"
                onClick={() => setPicked((prev) => prev.filter((x) => x.id !== p.id))}
              >
                빼기
              </button>
            </li>
          ))}
        </ul>
        <Button
          type="button"
          className="w-full py-2.5"
          disabled={busy || picked.length === 0}
          onClick={() => send({ locationIds: picked.map((p) => p.id) })}
        >
          담은 칸 출력
        </Button>
      </section>

      {outcome ? <OutcomeText outcome={outcome} /> : null}
    </div>
  );
}

function SkipList({ skipped }: { skipped: LabelBatch['skipped'] }) {
  return (
    <ul>
      {skipLines(skipped).map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
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
        <div role="alert" className="text-sm text-red-600">
          {r.skipped.length ? <SkipList skipped={r.skipped} /> : <p>찍을 라벨이 없어요</p>}
        </div>
      );
    case 'sent':
      return (
        <div role="status" className="text-sm text-gray-700">
          <p>{`라벨 ${r.labels}장을 보냈어요`}</p>
          {r.skipped.length ? (
            <div className="text-amber-700">
              <SkipList skipped={r.skipped} />
            </div>
          ) : null}
        </div>
      );
  }
}
