import { useEffect, useRef, useState } from 'react';
import { SkuPicker, type SelectedSku } from '../inventory/SkuPicker';
import { Button } from '../../core/design/Button';
import { QuantityInput, parseQuantity } from '../../core/design/QuantityInput';
import { useUnsavedWork } from '../../core/operations/useUnsavedWork';
import { useWorkCapabilities } from '../../core/operations/useWorkCapabilities';
import { useWorkDraft } from '../../core/operations/useWorkDraft';
import { useWorkRuntime } from '../../core/operations/OperationContext';
import { ApiError } from '../../core/data/httpClient';
import { errorMessage } from '../../core/data/errorMessage';
import { useAddCountItem } from './mutations';
import type { ScanLocationResult, ScanLocationItem } from './types';
interface AddDraft {
  sku: SelectedSku | null;
  quantity: string;
  key: string;
}
const emptyDraft = (): AddDraft => ({
  sku: null,
  quantity: '',
  key: crypto.randomUUID(),
});
export function AddCountItemSheet({
  sessionId,
  place,
  onCancel,
  onExisting,
  onConflict,
  onDone,
}: {
  sessionId: string;
  place: ScanLocationResult;
  onCancel: () => void;
  onExisting: (item: ScanLocationItem) => void;
  onConflict: (skuId: string) => Promise<ScanLocationItem | undefined>;
  onDone: (key: string) => Promise<void>;
}) {
  const runtime = useWorkRuntime();
  const capabilities = useWorkCapabilities();
  const add = useAddCountItem();
  const initial = useRef(emptyDraft());
  const draft = useWorkDraft(
    `count-add:${sessionId}:${place.locationId}`,
    initial.current
  );
  const [input, setInput] = useState(initial.current);
  const desired = useRef(input);
  const [hydrated, setHydrated] = useState(!runtime);
  const [saving, setSaving] = useState(0);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState(false);
  useUnsavedWork(true);
  const finishRef = useRef(onDone);
  finishRef.current = onDone;
  useEffect(() => {
    if (!draft.ready) return;
    let live = true;
    let loaded = false;
    async function restore() {
      const saved = await draft.read();
      if (!live) return;
      if (!loaded) {
        desired.current = saved;
        setInput(saved);
        setHydrated(true);
        loaded = true;
      }
      const op = runtime ? await runtime.store.get(saved.key) : null;
      if (op?.status === 'confirmed' && !busyRef.current) {
        busyRef.current = true;
        setBusy(true);
        try {
          await finishRef.current(saved.key);
          await draft.update(() => emptyDraft());
        } catch (e) {
          if (live) setError(errorMessage(e, 'stocktaking'));
        } finally {
          busyRef.current = false;
          if (live) setBusy(false);
        }
      }
    }
    void restore().catch((e) => {
      if (live) setError(errorMessage(e, 'stocktaking'));
    });
    const off = runtime?.runner.subscribe(
      () =>
        void restore().catch((e) => {
          if (live) setError(errorMessage(e, 'stocktaking'));
        })
    );
    return () => {
      live = false;
      off?.();
    };
  }, [draft.ready, runtime]);
  async function persist(next: AddDraft) {
    desired.current = next;
    setInput(next);
    setSaving((n) => n + 1);
    try {
      await draft.update(() => next);
      setSaveError(false);
    } catch {
      setSaveError(true);
      setError('입력을 저장하지 못했어요.');
    } finally {
      setSaving((n) => n - 1);
    }
  }
  async function clear() {
    await draft.update(() => emptyDraft());
  }
  const supported = capabilities.data?.stocktakingAddCountItem === true;
  const locked = busy || !hydrated;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <section
        role="dialog"
        aria-modal="true"
        aria-label="실사 상품 추가"
        className="max-h-[90vh] w-full max-w-lg space-y-3 overflow-y-auto rounded-xl bg-white p-5"
        onKeyDown={(e) => {
          // Search forms own Enter; action buttons must never accept a scanner terminator.
          if (
            (e.key === 'Enter' || e.code === 'NumpadEnter') &&
            !(e.target instanceof HTMLInputElement)
          )
            e.preventDefault();
        }}
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
          disabled={!supported || locked || saving > 0 || saveError}
          onSelect={(next) => {
            const existing = place.expectedItems.find(
              (item) => item.skuId === next.id
            );
            if (existing) {
              void clear()
                .then(() => onExisting(existing))
                .catch(() => setSaveError(true));
              return;
            }
            void persist({ sku: next, quantity: '', key: crypto.randomUUID() });
            setError(null);
          }}
        />
        {input.sku && (
          <>
            <p>
              {input.sku.name} · {input.sku.code}
            </p>
            <QuantityInput
              label="새 상품 실물 총수량"
              value={input.quantity}
              onChange={(quantity) =>
                void persist({
                  ...desired.current,
                  quantity,
                  key: crypto.randomUUID(),
                })
              }
              min={0}
              disabled={locked}
            />
          </>
        )}
        {saveError ? (
          <p role="alert">
            입력을 저장하지 못했어요. 이 화면에서 다시 저장해 주세요.
            <Button onClick={() => void persist(desired.current)}>
              입력 다시 저장
            </Button>
          </p>
        ) : (
          error && <p role="alert">{error}</p>
        )}
        <Button
          disabled={locked || saving > 0}
          onClick={() =>
            void clear()
              .then(onCancel)
              .catch(() => setSaveError(true))
          }
        >
          취소
        </Button>
        <Button
          disabled={
            !supported ||
            !input.sku ||
            parseQuantity(input.quantity, 0) === null ||
            locked ||
            saving > 0 ||
            saveError
          }
          onClick={async () => {
            if (!input.sku || busyRef.current) return;
            const count = parseQuantity(input.quantity, 0);
            if (count === null) return;
            busyRef.current = true;
            setBusy(true);
            setError(null);
            try {
              await draft.update(() => input);
              await add.mutateAsync({
                sessionId,
                locationId: place.locationId,
                skuId: input.sku.id,
                countedQuantity: count,
                idempotencyKey: input.key,
              });
              await onDone(input.key);
              await clear();
            } catch (e) {
              if (
                e instanceof ApiError &&
                e.code === 'STOCKTAKING_REVISION_CONFLICT'
              ) {
                try {
                  const existing = await onConflict(input.sku.id);
                  if (existing) {
                    await clear();
                    onExisting(existing);
                  } else setError('최신 목록을 확인한 뒤 다시 입력해 주세요.');
                } catch (refreshError) {
                  setError(errorMessage(refreshError, 'stocktaking'));
                }
              } else setError(errorMessage(e, 'stocktaking'));
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
