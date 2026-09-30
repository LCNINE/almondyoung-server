import { useRef, useState } from 'react';
import { useWarehouse } from '../../app/warehouse-context';
import { useApiClient } from '../../core/data/ApiClientProvider';
import { localStoragePrefs, type DevicePrefs } from '../../core/data/devicePrefs';
import { errorMessage } from '../../core/data/errorMessage';
import { Button } from '../../core/design/Button';
import { isReturnBinCode, readReturnBin, writeReturnBin } from './returnBin';
import { fetchReturnBin, isUnknownReturnBin, registerReturnBin } from './returnBinApi';

type Status = { kind: 'ok' | 'error'; text: string };

/** 설정 화면의 «내 되돌림 바구니» — 이 기기에서 뺀 상품이 들어갈 바구니. 등록은 명시적으로 한 번 더 누른다(오타 방지). */
export function ReturnBinSettings({ prefs = localStoragePrefs }: { prefs?: DevicePrefs }) {
  const { warehouseId } = useWarehouse();
  // 같은 설정 화면의 창고 선택이 실시간으로 바뀐다 — 창고마다 새로 시작해야 옛 창고의 바구니·등록 제안이 남지 않는다.
  return <ReturnBinSection key={warehouseId ?? ''} prefs={prefs} />;
}

function ReturnBinSection({ prefs }: { prefs: DevicePrefs }) {
  const api = useApiClient();
  const { warehouseId } = useWarehouse();
  const [current, setCurrent] = useState(() => readReturnBin(prefs, warehouseId));
  const [code, setCode] = useState('');
  const [unknown, setUnknown] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);

  const guarded = async (work: () => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      await work();
    } catch (error) {
      setStatus({ kind: 'error', text: errorMessage(error, 'returns') });
    } finally {
      running.current = false;
      setBusy(false);
    }
  };

  const assign = () =>
    guarded(async () => {
      const barcode = code.trim();
      setUnknown(null);
      if (!warehouseId) return;
      if (!isReturnBinCode(barcode)) {
        setStatus({ kind: 'error', text: '되돌림 바구니 바코드는 RB- 로 시작해요.' });
        return;
      }
      try {
        await fetchReturnBin(api, barcode, warehouseId);
      } catch (error) {
        if (!isUnknownReturnBin(error)) throw error;
        setUnknown(barcode);
        setStatus({ kind: 'error', text: `${barcode} 은 등록되지 않은 바구니예요.` });
        return;
      }
      writeReturnBin(prefs, { warehouseId, barcode });
      setCurrent(barcode);
      setCode('');
      setStatus({ kind: 'ok', text: `${barcode} 을 이 기기의 되돌림 바구니로 지정했어요.` });
    });

  const register = () =>
    guarded(async () => {
      if (!warehouseId || !unknown) return;
      const bin = await registerReturnBin(api, { warehouseId, barcode: unknown });
      writeReturnBin(prefs, { warehouseId, barcode: bin.barcode });
      setCurrent(bin.barcode);
      setUnknown(null);
      setCode('');
      setStatus({ kind: 'ok', text: `${bin.barcode} 을 등록하고 이 기기의 되돌림 바구니로 지정했어요.` });
    });

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-gray-700">내 되돌림 바구니</h2>
      <p className="text-xs text-gray-500">
        박스에서 뺀 상품을 담는 바구니예요. 바구니의 바코드(RB-…)를 한 번 스캔해 두면 이 기기에서 뺀 상품이 그 바구니로 기록돼요.
      </p>
      <p className="text-sm">{current ? `지금 바구니: ${current}` : '지정한 바구니가 없어요.'}</p>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void assign();
        }}
      >
        <input
          className="flex-1 rounded border px-3 py-2"
          aria-label="되돌림 바구니 바코드"
          placeholder="RB-…"
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            setUnknown(null);
          }}
        />
        <Button type="submit" disabled={busy || !code.trim()}>
          이 기기의 바구니로 지정
        </Button>
      </form>
      {unknown && (
        <Button type="button" disabled={busy} onClick={() => void register()}>
          새 바구니로 등록
        </Button>
      )}
      {current && (
        <Button
          type="button"
          className="border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
          onClick={() => {
            writeReturnBin(prefs, null);
            setCurrent(null);
            setStatus({ kind: 'ok', text: '되돌림 바구니 지정을 풀었어요.' });
          }}
        >
          지정 풀기
        </Button>
      )}
      {status && (
        <p role={status.kind === 'error' ? 'alert' : 'status'} className="text-sm">
          {status.text}
        </p>
      )}
    </section>
  );
}
