import { useEffect, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useWarehouse } from '../../app/warehouse-context';
import { STOCK_ADJUST_PERMISSION_MESSAGE } from '../../core/data/errorMessage';
import { LoadFailure } from '../../core/design/LoadFailure';
import { ScreenHeader } from '../../core/design/ScreenHeader';
import { useScanner } from '../../core/hardware/scan/useScanner';
import {
  WorkArea,
  useWorkAreaBlocked,
} from '../../core/operations/WorkBoundary';
import { useWorkPermissions } from '../../core/operations/useWorkCapabilities';
import { WarehousePicker } from '../warehouse/WarehousePicker';
import { SkuPicker, skuPickerMemory, type SelectedSku } from './SkuPicker';
import type { SkuSearchItem } from './types';
import { useSkuByBarcode } from './useSkuByBarcode';

const pickerMemory = skuPickerMemory();

export function ManufactureSelectScreen() {
  const navigate = useNavigate();
  const { isSet } = useWarehouse();
  const workBlocked = useWorkAreaBlocked('adjust');
  const permissions = useWorkPermissions();
  const byBarcode = useSkuByBarcode('always');

  const permissionDenied =
    !permissions.isError && permissions.data?.stockAdjust === false;
  const blocked = !isSet || permissionDenied || workBlocked;

  const [scanNotice, setScanNotice] = useState<string | null>(null);
  const [scanHits, setScanHits] = useState<SkuSearchItem[]>([]);
  const [lookupFailure, setLookupFailure] = useState<{
    code: string;
    error: unknown;
  } | null>(null);
  const lookupSeq = useRef(0);

  useEffect(() => {
    return () => {
      lookupSeq.current += 1;
    };
  }, [blocked]);

  const selectSku = (sku: SelectedSku) => {
    if (blocked) {
      return;
    }

    lookupSeq.current += 1;
    void navigate({
      to: '/inventory/manufacture/$sku',
      params: { sku: sku.id },
    });
  };

  const lookupBarcode = (code: string) => {
    if (blocked || byBarcode.isPending) {
      return;
    }

    const seq = ++lookupSeq.current;

    setScanNotice(null);
    setScanHits([]);
    setLookupFailure(null);
    byBarcode.mutate(code, {
      onSuccess: (hits) => {
        if (seq !== lookupSeq.current) {
          return;
        }

        if (hits.length === 1) {
          selectSku(hits[0]);
        } else if (hits.length === 0) {
          setScanNotice(`등록되지 않은 바코드예요: ${code}`);
        } else {
          setScanHits(hits);
        }
      },
      onError: (error) => {
        if (seq !== lookupSeq.current) {
          return;
        }

        setLookupFailure({ code, error });
      },
    });
  };

  useScanner((event) => lookupBarcode(event.code));

  return (
    <WorkArea kind="adjust">
      <div className="space-y-4">
        <ScreenHeader title="제조 완료 등록" backTo="/inventory" />

        {permissionDenied && (
          <p role="alert" className="text-sm text-red-600">
            {STOCK_ADJUST_PERMISSION_MESSAGE}
          </p>
        )}

        {!isSet ? (
          <div className="space-y-3 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4">
            <p className="text-sm text-gray-600">창고를 먼저 선택해 주세요.</p>
            <WarehousePicker />
          </div>
        ) : (
          <>
            <p className="text-sm text-gray-600">
              만든 상품의 바코드를 스캔하세요.
            </p>

            {scanNotice && (
              <p role="status" className="text-sm text-amber-700">
                {scanNotice}
              </p>
            )}

            {scanHits.length > 1 && (
              <section className="space-y-2">
                <h2 className="text-sm font-semibold text-gray-700">
                  스캔한 바코드의 상품
                </h2>
                <ul className="space-y-1">
                  {scanHits.map((hit) => (
                    <li key={hit.id}>
                      <button
                        type="button"
                        disabled={blocked}
                        className="w-full rounded-md border border-gray-200 bg-white p-3 text-left active:bg-gray-50"
                        onClick={() => selectSku(hit)}
                      >
                        <span className="block font-medium text-gray-800">
                          {hit.name}
                        </span>
                        <span className="block font-mono text-xs text-gray-500">
                          {hit.code}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {lookupFailure && !blocked && (
              <LoadFailure
                message={`바코드를 확인하지 못했어요: ${lookupFailure.code}.`}
                error={lookupFailure.error}
                retrying={byBarcode.isPending}
                onRetry={() => lookupBarcode(lookupFailure.code)}
              />
            )}

            <SkuPicker disabled={blocked} onSelect={selectSku} memory={pickerMemory} />
          </>
        )}
      </div>
    </WorkArea>
  );
}
