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
import { fetchReturnBin, putawayReturn, type ReturnBinContents } from './returnBinApi';
import { isReturnBinCode } from './returnBin';
import { WorkArea } from '../../core/operations/WorkBoundary';

/** 되돌림 바구니 → 원래 로케이션(스펙 §8). 바구니 스캔 → 상품·원래 로케이션·수량 → 상품 스캔 → 로케이션 스캔. */
function ReturnPutawayContent() {
  const api = useApiClient();
  const { warehouseId, isSet } = useWarehouse();
  const sku = useSkuByBarcode();
  const [step, setStep] = useState<PutawayStep>({ kind: 'bin' });
  const stepRef = useRef(step);
  stepRef.current = step;
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const busy = useRef(false);

  const showBin = (bin: ReturnBinContents, emptyText: string) => {
    setStep(bin.items.length ? { kind: 'product', bin } : { kind: 'bin' });
    return bin.items.length ? null : emptyText;
  };

  // 재시작 뒤 복원된 스캔도 이 함수로 돌아온다 — 화면 단계(step)에 기대지 않고 이벤트만으로 보낸다.
  const queue = useWorkScanQueue<{ binBarcode: string; warehouseId: string; productBarcode: string; locationCode: string }>(
    async (input, id) => {
      try {
        const result = await putawayReturn(api, {
          binBarcode: input.binBarcode,
          warehouseId: input.warehouseId,
          productBarcode: input.productBarcode,
          locationCode: input.locationCode,
          idempotencyKey: id,
        });
        const next = afterPutaway({ ...result.returnBin, items: result.items }, result.items);
        setStep(next);
        setNotice({
          kind: 'ok',
          text: next.kind === 'bin' ? '바구니가 비었어요. 다음 바구니를 스캔해 주세요.' : '넣었어요. 다음 상품을 스캔해 주세요.',
        });
      } catch (error) {
        if (!(error instanceof ApiError && error.outcome === 'rejected')) {
          setNotice({ kind: 'error', text: errorMessage(error, 'return-putaway') });
          throw error;
        }
        const text = errorMessage(error, 'return-putaway');
        // 로케이션만 틀렸으면 같은 상품을 계속 기다린다. 그 밖의 거절은 이 상품을 더 넣을 수 없다는 뜻이라
        // 상품 단계로 돌아가 바구니를 다시 읽는다(다른 작업자가 비웠을 수도 있다).
        if (error.code !== 'RETURN_LOCATION_MISMATCH') {
          try {
            const bin = await fetchReturnBin(api, input.binBarcode, input.warehouseId);
            setNotice({ kind: 'error', text });
            showBin(bin, text);
            return;
          } catch {
            const current = stepRef.current;
            if (current.kind === 'location') setStep({ kind: 'product', bin: current.bin });
          }
        }
        setNotice({ kind: 'error', text });
      }
    },
    'return-putaway',
  );

  const loadBin = async (code: string, wh: string) => {
    const bin = await fetchReturnBin(api, code, wh);
    const empty = showBin(bin, '빈 바구니예요.');
    setNotice(empty ? { kind: 'ok', text: empty } : null);
  };

  const accept = async (code: string) => {
    if (!warehouseId || busy.current) return;
    // 서버는 재시도한 한 개와 새로 찍은 한 개를 구별하지 못한다 — 앞 스캔의 결과를 확인할 때까지 새 스캔을 받지 않는다.
    if (queue.storageError() || queue.error()) return;
    if (!queue.ready || queue.size() > 0) {
      setNotice({ kind: 'error', text: '앞의 스캔을 처리하는 중이에요. 잠시 뒤에 다시 찍어 주세요.' });
      return;
    }
    const current = stepRef.current;
    busy.current = true;
    try {
      if (current.kind === 'bin' || isReturnBinCode(code)) {
        await loadBin(code, warehouseId);
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
        queue.enqueue({
          binBarcode: current.bin.barcode,
          warehouseId,
          productBarcode: current.productBarcode,
          locationCode: code,
        });
      }
    } catch (error) {
      setNotice({ kind: 'error', text: errorMessage(error, 'return-putaway') });
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
          {step.target.locations.map((location) => (
            <div key={location.key}>
              <p className="font-medium">{location.skuName}</p>
              <p>{location.locationCode} 에 넣어 주세요</p>
            </div>
          ))}
          <Button
            onClick={() => {
              setStep({ kind: 'product', bin: step.bin });
              setNotice(null);
            }}
          >
            다른 상품
          </Button>
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

export function ReturnPutawayScreen() {
  return (
    <WorkArea kind="return-bins">
      <ReturnPutawayContent />
    </WorkArea>
  );
}
