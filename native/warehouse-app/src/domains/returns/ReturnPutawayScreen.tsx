import { useEffect, useRef, useState } from 'react';
import { useWarehouse } from '../../app/warehouse-context';
import { useApiClient } from '../../core/data/ApiClientProvider';
import { errorMessage } from '../../core/data/errorMessage';
import { ApiError } from '../../core/data/httpClient';
import { Button } from '../../core/design/Button';
import { ScreenHeader } from '../../core/design/ScreenHeader';
import { BarcodeInput } from '../../core/hardware/scan/BarcodeInput';
import { useScanner } from '../../core/hardware/scan/useScanner';
import { SCAN_STORAGE_MESSAGE, useWorkScanQueue } from '../../core/hardware/scan/useWorkScanQueue';
import { WarehousePicker } from '../warehouse/WarehousePicker';
import { afterPutaway, returnLocations, type PutawayStep } from './returnPutaway';
import { fetchMyReturnBin, putawayReturn } from './returnBinApi';
import { WorkArea } from '../../core/operations/WorkBoundary';

function ReturnPutawayContent({ warehouseId }: { warehouseId: string }) {
  const api = useApiClient();
  const [step, setStep] = useState<PutawayStep>({ kind: 'loading' });
  const stepRef = useRef(step);
  stepRef.current = step;
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);

  const queue = useWorkScanQueue<{ binBarcode: string; warehouseId: string; productBarcode: string; locationCode?: string }>(
    async (input, id) => {
      try {
        const result = await putawayReturn(api, { ...input, idempotencyKey: id });

        setStep(afterPutaway({ ...result.returnBin, items: result.items }, result.items));
        setNotice(result.items.length ? { kind: 'ok', text: '넣었어요. 다음 상품을 스캔해 주세요.' } : null);
      } catch (error) {
        if (!(error instanceof ApiError && error.outcome === 'rejected')) {
          setNotice({ kind: 'error', text: errorMessage(error, 'return-putaway') });
          throw error;
        }

        const text = errorMessage(error, 'return-putaway');
        const current = stepRef.current;

        if (error.code === 'RETURN_LOCATION_REQUIRED' || error.code === 'RETURN_LOCATION_MISMATCH') {
          const bin = current.kind === 'loading' ? await fetchMyReturnBin(api, input.warehouseId) : current.bin;

          setStep({
            kind: 'location',
            bin,
            productBarcode: input.productBarcode,
            locations: returnLocations(error.errors),
          });
        } else {
          try {
            const bin = await fetchMyReturnBin(api, input.warehouseId);

            setStep({ kind: 'product', bin });
          } catch {
            if (current.kind === 'location') setStep({ kind: 'product', bin: current.bin });
          }
        }

        setNotice({ kind: 'error', text });
      }
    },
    'return-putaway',
  );

  useEffect(() => {
    if (!queue.ready || step.kind !== 'loading') return;

    let live = true;

    fetchMyReturnBin(api, warehouseId).then(
      (bin) => {
        if (!live) return;

        setStep({ kind: 'product', bin });
        setNotice(null);
      },
      (error: unknown) => {
        if (live) setNotice({ kind: 'error', text: errorMessage(error, 'return-putaway') });
      },
    );

    return () => {
      live = false;
    };
  }, [api, warehouseId, queue.ready, step.kind, loadAttempt]);

  const accept = (code: string) => {
    if (queue.storageError() || queue.error()) return;
    if (!queue.ready || queue.size() > 0) {
      setNotice({ kind: 'error', text: '앞의 스캔을 처리하는 중이에요. 잠시 뒤에 다시 찍어 주세요.' });
      return;
    }

    const current = stepRef.current;

    if (current.kind === 'loading' || current.bin.items.length === 0) return;

    setNotice(null);
    queue.enqueue({
      binBarcode: current.bin.barcode,
      warehouseId,
      productBarcode: current.kind === 'product' ? code : current.productBarcode,
      ...(current.kind === 'location' ? { locationCode: code } : {}),
    });
  };

  useScanner((event) => accept(event.code));

  const empty = step.kind !== 'loading' && step.bin.items.length === 0;
  const prompt =
    step.kind === 'loading' ? '되돌릴 상품을 불러오고 있어요.' : empty ? '되돌릴 상품이 없어요.' : step.kind === 'product' ? '넣을 상품을 스캔해 주세요.' : '로케이션을 스캔해 주세요.';

  return (
    <div className="space-y-4">
      <ScreenHeader title="되돌림 적치" backTo="/" />
      <p className="text-sm text-neutral-500">{prompt}</p>
      {step.kind !== 'loading' && (
        <ul className="space-y-1">
          {step.bin.items.map((item) => (
            <li key={`${item.skuId}|${item.sourceLocationId}`} className="rounded border px-3 py-2">
              {item.skuName} {item.qty}개 → {item.locationCode}
            </li>
          ))}
        </ul>
      )}
      {step.kind === 'location' && (
        <section role="region" aria-label="넣을 곳" className="rounded border border-blue-300 px-3 py-2">
          {step.locations.map((location) => (
            <p key={location.locationCode}>{location.locationCode} · {location.qty}개</p>
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
          앞의 스캔이 처리됐는지 확인하지 못했어요. 같은 상품을 다시 찍지 말고 처리 내역 확인을 눌러 주세요.
        </p>
      ) : notice ? (
        <p role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.text}</p>
      ) : null}
      {queue.error() ? <Button onClick={() => void queue.retryHead().catch(() => {})}>처리 내역 확인</Button> : null}
      {step.kind === 'loading' && notice && !queue.error() ? (
        <Button onClick={() => setLoadAttempt((attempt) => attempt + 1)}>다시 불러오기</Button>
      ) : null}
      {step.kind !== 'loading' && !empty && (
        <BarcodeInput
          label={step.kind === 'product' ? '상품 바코드' : '로케이션 코드'}
          onSubmit={accept}
        />
      )}
    </div>
  );
}

export function ReturnPutawayScreen() {
  const { warehouseId } = useWarehouse();

  return (
    <WorkArea kind="return-bins">
      {warehouseId ? (
        <ReturnPutawayContent key={warehouseId} warehouseId={warehouseId} />
      ) : (
        <div className="space-y-4">
          <ScreenHeader title="되돌림 적치" backTo="/" />
          <WarehousePicker />
        </div>
      )}
    </WorkArea>
  );
}
