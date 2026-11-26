import { Link } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { useWarehouse } from '../../app/warehouse-context';
import { useApiClient } from '../../core/data/ApiClientProvider';
import { errorMessage } from '../../core/data/errorMessage';
import { ApiError } from '../../core/data/httpClient';
import { Button } from '../../core/design/Button';
import { cn } from '../../core/design/cn';
import { ScreenHeader } from '../../core/design/ScreenHeader';
import { BarcodeInput } from '../../core/hardware/scan/BarcodeInput';
import { useScanner } from '../../core/hardware/scan/useScanner';
import { SCAN_STORAGE_MESSAGE, useWorkScanQueue } from '../../core/hardware/scan/useWorkScanQueue';
import { WarehousePicker } from '../warehouse/WarehousePicker';
import { afterPutaway, returnLocations, type PutawayStep } from './returnPutaway';
import { fetchMyReturnBin, putawayReturn, type PutawayResult } from './returnBinApi';
import { WorkArea } from '../../core/operations/WorkBoundary';

interface CompletedPutaway {
  key: string;
  skuName: string;
  skuCode: string;
  locationCode: string;
  qty: number;
}

const DESCRIPTION = '상품을 원래 선반에 놓고 바코드를 스캔하세요.';

function completedFrom(result: PutawayResult): CompletedPutaway | null {
  const { skuId, skuName, skuCode, locationCode, putAwayQty } = result;

  if (!skuId || !skuName || !locationCode) return null;
  if (!Number.isSafeInteger(putAwayQty) || putAwayQty <= 0) return null;

  return { key: `${skuId}|${locationCode}`, skuName, skuCode: skuCode ?? '', locationCode, qty: putAwayQty };
}

function ReturnPutawayContent({ warehouseId }: { warehouseId: string }) {
  const api = useApiClient();
  const [step, setStep] = useState<PutawayStep>({ kind: 'loading' });
  const stepRef = useRef(step);
  stepRef.current = step;
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [completed, setCompleted] = useState<CompletedPutaway[]>([]);
  const countedRequests = useRef(new Set<string>());

  const queue = useWorkScanQueue<{ binBarcode: string; warehouseId: string; productBarcode: string; locationCode?: string }>(
    async (input, id) => {
      try {
        const result = await putawayReturn(api, { ...input, idempotencyKey: id });
        const entry = completedFrom(result);

        setStep(afterPutaway({ ...result.returnBin, items: result.items }, result.items));
        setNotice(result.items.length ? { kind: 'ok', text: '넣었어요. 다음 상품을 스캔해 주세요.' } : null);

        if (entry && !countedRequests.current.has(id)) {
          countedRequests.current.add(id);
          setCompleted((list) => {
            const index = list.findIndex((row) => row.key === entry.key);

            if (index === -1) return [...list, entry];

            return list.map((row, at) => (at === index ? { ...row, qty: row.qty + entry.qty } : row));
          });
        }
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
  const items = step.kind === 'loading' ? [] : step.bin.items;
  const totalQty = items.reduce((sum, item) => sum + item.qty, 0);
  const choosing = step.kind === 'location';

  const stepLabel = step.kind === 'loading' ? '불러오는 중' : empty ? '완료' : choosing ? '위치 확인' : '상품 스캔';
  const title =
    step.kind === 'loading'
      ? '복귀할 상품을 불러오고 있어요.'
      : empty
        ? '되돌릴 상품이 없어요.'
        : choosing
          ? '어느 선반에 놓았나요?'
          : '선반에 놓고 상품을 스캔하세요';
  const guide =
    step.kind === 'loading'
      ? null
      : empty
        ? '대기 상품을 모두 처리했습니다.'
        : choosing
          ? '복귀 위치가 여러 곳입니다. 실제로 놓은 선반의 위치 바코드를 스캔하세요.'
          : '복귀 선반이 한 곳이면 상품 스캔으로 1개가 처리됩니다. 별도로 확인 버튼을 누를 필요가 없습니다.';

  const feedback = (
    <>
      {queue.storageError() ? (
        <p role="alert" className="text-xs leading-[1.7] text-[#b42318]">
          {SCAN_STORAGE_MESSAGE}
        </p>
      ) : queue.error() ? (
        <p role="alert" className="text-xs leading-[1.7] text-[#b42318]">
          앞의 스캔이 처리됐는지 확인하지 못했어요. 같은 상품을 다시 찍지 말고 처리 내역 확인을 눌러 주세요.
        </p>
      ) : notice ? (
        <p
          role={notice.kind === 'error' ? 'alert' : 'status'}
          className={cn('text-xs leading-[1.7]', notice.kind === 'error' ? 'text-[#b42318]' : 'text-[#52525b]')}
        >
          {notice.text}
        </p>
      ) : choosing ? (
        <p className="text-xs leading-[1.7] text-[#52525b]">위치를 확인하기 전에는 수량이 줄지 않습니다.</p>
      ) : null}
      {queue.error() ? <Button onClick={() => void queue.retryHead().catch(() => {})}>처리 내역 확인</Button> : null}
    </>
  );

  if (empty) {
    return (
      <div className="space-y-5">
        <ScreenHeader title="선반 복귀" backTo="/" description="대기 상품을 모두 처리했습니다." />
        <section
          aria-label="선반 복귀 완료"
          className="mx-auto w-full max-w-[760px] rounded-xl border border-[#e4e4e7] bg-white p-[35px] max-[600px]:px-[18px] max-[600px]:py-6"
        >
          <h2 className="text-2xl font-bold text-[#27272a]">선반 복귀 완료</h2>
          <p className="mt-2.5 text-[13px] text-[#71717a]">복귀 대기 0개</p>
          <ul aria-label="완료 상품" className="my-[25px] border-t border-[#e4e4e7]">
            {completed.map((entry) => (
              <li
                key={entry.key}
                className="flex items-center gap-5 border-b border-[#e4e4e7] py-[18px] text-[13px] max-[600px]:flex-wrap max-[600px]:gap-2.5"
              >
                <span className="flex-1 text-[#27272a]">{entry.skuName}</span>
                <strong className="font-semibold text-[#27272a]">{entry.qty}개</strong>
                <span className="text-[#71717a]">{entry.locationCode}</span>
              </li>
            ))}
          </ul>
          {feedback}
          <Link
            to="/putaway"
            className="inline-flex items-center justify-center rounded-lg bg-[#2563eb] px-4 py-2.5 text-sm font-semibold text-white"
          >
            작업 목록으로 돌아가기
          </Link>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <ScreenHeader title="선반 복귀" backTo="/" description={empty ? '대기 상품을 모두 처리했습니다.' : DESCRIPTION} />
      <div className="grid h-[clamp(360px,52vh,560px)] min-h-0 grid-cols-1 items-stretch gap-6 max-[900px]:h-auto min-[901px]:grid-cols-[minmax(300px,0.9fr)_minmax(450px,1.4fr)]">
        <section
          aria-label="선반 복귀 대기"
          className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-[#e4e4e7] bg-white max-[900px]:max-h-[400px]"
        >
          <div className="flex shrink-0 items-center justify-between gap-2.5 border-b border-[#e4e4e7] px-[22px] py-[19px]">
            <h3 className="text-base font-semibold text-[#27272a]">선반 복귀 대기</h3>
            <span className="text-[13px] font-semibold text-[#27272a]">
              {items.length}건 · {totalQty}개
            </span>
          </div>
          <div
            role="region"
            aria-label="선반 복귀 대기 목록"
            tabIndex={0}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-gutter:stable] [scrollbar-width:thin]"
          >
            <ul aria-label="대기 상품">
              {items.map((item) => (
                <li
                  key={`${item.skuId}|${item.sourceLocationId}`}
                  className="border-t border-[#e4e4e7] px-[22px] py-[18px] first:border-t-0"
                >
                  <strong className="block text-sm leading-normal font-semibold text-[#27272a]">{item.skuName}</strong>
                  <code className="mt-1.5 block text-[11px] text-[#71717a]">{item.skuCode}</code>
                  <div className="mt-3 flex items-center justify-between text-[13px]">
                    <span className="text-[#71717a]">
                      복귀 선반 <strong className="ml-2 font-semibold text-[#27272a]">{item.locationCode}</strong>
                    </span>
                    <strong className="font-semibold text-[#27272a]">{item.qty}개</strong>
                  </div>
                </li>
              ))}
            </ul>
            {completed.length > 0 && (
              <section aria-label="완료 내역" className="border-t border-[#e4e4e7] bg-[#fafafa]">
                <h4 className="px-[22px] pt-4 text-xs font-semibold text-[#71717a]">완료 내역</h4>
                <ul aria-label="완료 상품">
                  {completed.map((entry) => (
                    <li
                      key={entry.key}
                      className="flex items-center gap-4 border-t border-[#e4e4e7] px-[22px] py-3 text-[13px] first:border-t-0"
                    >
                      <span className="min-w-0 flex-1 text-[#27272a]">{entry.skuName}</span>
                      <strong className="font-semibold text-[#27272a]">{entry.qty}개</strong>
                      <span className="text-[#71717a]">{entry.locationCode}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
          <div className="shrink-0 border-t border-[#e4e4e7] bg-[#fafafa] px-[22px] py-3 text-[11px] text-[#71717a]">
            목록을 스크롤해 복귀 위치를 확인하세요.
          </div>
        </section>
        <section
          aria-label="스캔"
          className="flex min-h-0 min-w-0 flex-col gap-6 overflow-y-auto rounded-xl border border-[#e4e4e7] bg-white p-7 max-[900px]:h-auto max-[600px]:gap-5 max-[600px]:px-[17px] max-[600px]:py-5 [&>*]:shrink-0"
        >
          <div>
            <span className="mb-2.5 block text-xs text-[#71717a]">{stepLabel}</span>
            <h2 className="text-2xl font-bold text-[#27272a] max-[600px]:text-xl">{title}</h2>
            {guide ? <p className="mt-3 text-[13px] leading-[1.9] text-[#71717a]">{guide}</p> : null}
          </div>
          {step.kind === 'location' && (
            <section
              role="region"
              aria-label="넣을 곳"
              className="flex flex-col gap-3 border-y border-[#e4e4e7] py-[18px]"
            >
              {step.locations.map((location) => (
                <p key={location.locationCode} className="flex items-center justify-between text-[13px]">
                  <strong className="font-semibold text-[#27272a]">{location.locationCode}</strong>
                  <span className="text-xs text-[#71717a]">{` · ${location.qty}개 대기`}</span>
                </p>
              ))}
            </section>
          )}
          {step.kind !== 'loading' && !empty && (
            <BarcodeInput
              label={step.kind === 'product' ? '복귀 상품 바코드' : '복귀 선반 바코드'}
              placeholder={step.kind === 'product' ? '상품 바코드 스캔' : '선반 위치 바코드 스캔'}
              hideSubmit
              onSubmit={accept}
            />
          )}
          {feedback}
          {step.kind === 'loading' && notice && !queue.error() ? (
            <Button onClick={() => setLoadAttempt((attempt) => attempt + 1)}>다시 불러오기</Button>
          ) : null}
          {choosing && (
            <button
              type="button"
              className="self-start text-[13px] text-[#71717a] underline"
              onClick={() => {
                setStep({ kind: 'product', bin: step.bin });
                setNotice(null);
              }}
            >
              다른 상품
            </button>
          )}
        </section>
      </div>
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
          <ScreenHeader title="선반 복귀" backTo="/" description={DESCRIPTION} />
          <WarehousePicker />
        </div>
      )}
    </WorkArea>
  );
}
