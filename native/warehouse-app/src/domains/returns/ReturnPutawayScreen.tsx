import { useRef, useState } from 'react';
import { useWarehouse } from '../../app/warehouse-context';
import { useApiClient } from '../../core/data/ApiClientProvider';
import { errorMessage } from '../../core/data/errorMessage';
import { ApiError } from '../../core/data/httpClient';
import { Button } from '../../core/design/Button';
import { ScreenHeader } from '../../core/design/ScreenHeader';
import { BarcodeInput } from '../../core/hardware/scan/BarcodeInput';
import { useScanner } from '../../core/hardware/scan/useScanner';
import { SCAN_STORAGE_MESSAGE, useWorkScanQueue } from '../../core/hardware/scan/useWorkScanQueue';
import { useSkuByBarcode } from '../inventory/useSkuByBarcode';
import { WarehousePicker } from '../warehouse/WarehousePicker';
import { afterPutaway, pickTarget, type PutawayStep } from './returnPutaway';
import { fetchReturnBin, putawayReturn } from './returnBinApi';

/** 되돌림 바구니 → 원래 로케이션(스펙 §8). 바구니 스캔 → 상품·원래 로케이션·수량 → 상품 스캔 → 로케이션 스캔. */
export function ReturnPutawayScreen() {
  const api = useApiClient();
  const { warehouseId, isSet } = useWarehouse();
  const sku = useSkuByBarcode();
  const [step, setStep] = useState<PutawayStep>({ kind: 'bin' });
  const stepRef = useRef(step);
  stepRef.current = step;
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const busy = useRef(false);

  const queue = useWorkScanQueue<{ binBarcode: string; productBarcode: string; locationCode: string }>(
    async (input, id) => {
      const current = stepRef.current;
      if (!warehouseId || current.kind !== 'location') return;
      try {
        const result = await putawayReturn(api, { ...input, warehouseId, idempotencyKey: id });
        const next = afterPutaway(current.bin, result.items);
        setStep(next);
        setNotice({
          kind: 'ok',
          text: next.kind === 'bin' ? '바구니가 비었어요. 다음 바구니를 스캔해 주세요.' : '넣었어요. 다음 상품을 스캔해 주세요.',
        });
      } catch (error) {
        setNotice({ kind: 'error', text: errorMessage(error, 'returns') });
        if (!(error instanceof ApiError && error.outcome === 'rejected')) throw error;
      }
    },
    'return-putaway',
  );

  const accept = async (code: string) => {
    if (!warehouseId || busy.current) return;
    // 서버는 재시도한 한 개와 새로 찍은 한 개를 구별하지 못한다 — 앞 스캔의 결과를 확인할 때까지 새 스캔을 받지 않는다.
    if (queue.storageError() || queue.error()) return;
    const current = stepRef.current;
    busy.current = true;
    try {
      if (current.kind === 'bin') {
        const bin = await fetchReturnBin(api, code, warehouseId);
        setStep(bin.items.length ? { kind: 'product', bin } : { kind: 'bin' });
        setNotice(bin.items.length ? null : { kind: 'ok', text: '빈 바구니예요.' });
      } else if (current.kind === 'product') {
        const found = await sku.mutateAsync(code);
        const target = pickTarget(
          current.bin,
          found.map((item) => item.id),
        );
        if (!target) {
          setNotice({ kind: 'error', text: '이 바구니에 없는 상품이에요.' });
          return;
        }
        setStep({ kind: 'location', bin: current.bin, productBarcode: code, target });
        setNotice(null);
      } else {
        setNotice(null);
        queue.enqueue({ binBarcode: current.bin.barcode, productBarcode: current.productBarcode, locationCode: code });
      }
    } catch (error) {
      setNotice({ kind: 'error', text: errorMessage(error, 'returns') });
    } finally {
      busy.current = false;
    }
  };
  useScanner((event) => void accept(event.code));

  if (!isSet) {
    return (
      <div className="space-y-4">
        <ScreenHeader title="되돌림 적치" backTo="/" />
        <WarehousePicker />
      </div>
    );
  }
  const prompt =
    step.kind === 'bin' ? '되돌림 바구니를 스캔해 주세요.' : step.kind === 'product' ? '넣을 상품을 스캔해 주세요.' : '로케이션을 스캔해 주세요.';
  return (
    <div className="space-y-4">
      <ScreenHeader title="되돌림 적치" backTo="/" />
      <p className="text-sm text-neutral-500">{prompt}</p>
      {step.kind !== 'bin' && (
        <section className="space-y-1">
          <p className="font-medium">바구니 {step.bin.barcode}</p>
          <ul className="space-y-1">
            {step.bin.items.map((item) => (
              <li key={`${item.skuId}|${item.sourceLocationId}`} className="rounded border px-3 py-2">
                [{item.locationCode}] {item.skuName} {item.qty}개
              </li>
            ))}
          </ul>
        </section>
      )}
      {step.kind === 'location' && (
        <section role="region" aria-label="넣을 곳" className="rounded border border-blue-300 px-3 py-2">
          <p className="font-medium">{step.target.skuName}</p>
          {step.target.locations.map((location) => (
            <p key={location.locationCode}>{location.locationCode} 에 넣어 주세요</p>
          ))}
        </section>
      )}
      {queue.storageError() ? (
        <p role="alert">{SCAN_STORAGE_MESSAGE}</p>
      ) : queue.error() ? (
        <p role="alert">
          앞의 스캔이 처리됐는지 확인하지 못했어요. 같은 상품을 다시 찍지 말고 「처리 내역 확인」을 눌러 주세요.
        </p>
      ) : notice ? (
        <p role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.text}</p>
      ) : null}
      {queue.error() ? <Button onClick={() => void queue.retryHead().catch(() => {})}>처리 내역 확인</Button> : null}
      <BarcodeInput
        label={step.kind === 'bin' ? '바구니 바코드' : step.kind === 'product' ? '상품 바코드' : '로케이션 코드'}
        onSubmit={(code) => void accept(code)}
      />
    </div>
  );
}
