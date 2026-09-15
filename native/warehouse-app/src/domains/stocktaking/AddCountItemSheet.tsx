import { useRef, useState } from 'react';
import { SkuPicker, type SelectedSku } from '../inventory/SkuPicker';
import { Button } from '../../core/design/Button';
import { QuantityInput, parseQuantity } from '../../core/design/QuantityInput';
import { useUnsavedWork } from '../../core/operations/useUnsavedWork';
import { useWorkCapabilities } from '../../core/operations/useWorkCapabilities';
import { errorMessage } from '../../core/data/errorMessage';
import { useAddCountItem } from './mutations';
import type { ScanLocationResult, ScanLocationItem } from './types';
export function AddCountItemSheet({
  sessionId,
  place,
  onCancel,
  onExisting,
  onDone,
}: {
  sessionId: string;
  place: ScanLocationResult;
  onCancel: () => void;
  onExisting: (item: ScanLocationItem) => void;
  onDone: (key: string) => Promise<void>;
}) {
  const capabilities = useWorkCapabilities();
  const add = useAddCountItem();
  const [sku, setSku] = useState<SelectedSku | null>(null);
  const [quantity, setQuantity] = useState('');
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  useUnsavedWork(true);
  const supported = capabilities.data?.stocktakingAddCountItem === true;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <section
        role="dialog"
        aria-modal="true"
        aria-label="실사 상품 추가"
        className="max-h-[90vh] w-full max-w-lg space-y-3 overflow-y-auto rounded-xl bg-white p-5"
      >
        <h2 className="font-semibold">{place.locationCode} · 상품 추가</h2>
        {capabilities.isPending ? (
          <p role="status">사용 가능 여부를 확인하고 있어요.</p>
        ) : !supported ? (
          <p role="alert">
            새 상품 실사를 사용하려면 서버 연결과 업데이트를 확인해 주세요.
            <Button onClick={() => void capabilities.refetch()}>
              다시 확인
            </Button>
          </p>
        ) : null}
        <SkuPicker
          disabled={!supported || busy}
          onSelect={(next) => {
            const existing = place.expectedItems.find(
              (item) => item.skuId === next.id
            );
            if (existing) {
              onExisting(existing);
              return;
            }
            setSku(next);
            setQuantity('');
            setKey(crypto.randomUUID());
            setError(null);
          }}
        />
        {sku && (
          <>
            <p>
              {sku.name} · {sku.code}
            </p>
            <QuantityInput
              label="새 상품 실물 총수량"
              value={quantity}
              onChange={(value) => {
                setQuantity(value);
                setKey(crypto.randomUUID());
              }}
              min={0}
              disabled={busy}
            />
          </>
        )}
        {error && <p role="alert">{error}</p>}
        <Button disabled={busy} onClick={onCancel}>
          취소
        </Button>
        <Button
          disabled={
            !supported || !sku || parseQuantity(quantity, 0) === null || busy
          }
          onClick={async () => {
            if (!sku || busyRef.current) return;
            const count = parseQuantity(quantity, 0);
            if (count === null) return;
            busyRef.current = true;
            setBusy(true);
            setError(null);
            try {
              await add.mutateAsync({
                sessionId,
                locationId: place.locationId,
                skuId: sku.id,
                countedQuantity: count,
                idempotencyKey: key,
              });
              await onDone(key);
            } catch (e) {
              setError(errorMessage(e, 'stocktaking'));
            } finally {
              busyRef.current = false;
              setBusy(false);
            }
          }}
        >
          실사에 추가
        </Button>
      </section>
    </div>
  );
}
