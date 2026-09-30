import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useWarehouse } from '../../app/warehouse-context';
import { useApiClient } from '../../core/data/ApiClientProvider';
import { Button } from '../../core/design/Button';
import { useScanner } from '../../core/hardware/scan/useScanner';
import { removeBoxFromBatch, type RemoveOutcome } from './batchRemove';

/** 시작된 배치에서 집기 전 박스를 뺀다(스펙 §8, PR 2). 송장번호(스캔 가능)와 사유가 둘 다 있어야 보낸다. */
export function RemoveBoxPanel({ batchId, onClose }: { batchId: string; onClose: () => void }) {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const { warehouseId } = useWarehouse();
  const [trackingNo, setTrackingNo] = useState('');
  const [reason, setReason] = useState('');
  const [outcome, setOutcome] = useState<RemoveOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);

  useScanner((event) => setTrackingNo(event.code));

  const submit = async () => {
    if (running.current || !warehouseId || !trackingNo.trim() || !reason.trim()) return;
    running.current = true;
    setBusy(true);
    try {
      const result = await removeBoxFromBatch(
        { api, newKey: () => crypto.randomUUID() },
        { batchId, warehouseId, trackingNo, reason },
      );
      setOutcome(result);
      if (result.kind === 'removed') {
        setTrackingNo('');
        await queryClient.invalidateQueries({ queryKey: ['outbound-batches'] });
        await queryClient.invalidateQueries({ queryKey: ['waybill-label-states'] });
      }
    } finally {
      running.current = false;
      setBusy(false);
    }
  };

  return (
    <section className="space-y-2 rounded border border-amber-300 px-3 py-2">
      <p className="font-medium">이 배치에서 박스 빼기</p>
      <p className="text-sm text-neutral-500">아직 상품을 담지 않은 박스만 뺄 수 있어요.</p>
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <input
          className="w-full rounded border px-3 py-2"
          aria-label="송장번호"
          placeholder="송장번호 (스캔)"
          value={trackingNo}
          onChange={(e) => setTrackingNo(e.target.value)}
        />
        <input
          className="w-full rounded border px-3 py-2"
          aria-label="빼는 이유"
          placeholder="예: 고객 요청, 급한 변경"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <Button type="submit" disabled={busy || !trackingNo.trim() || !reason.trim()}>
          빼기
        </Button>
      </form>
      {outcome && <p role={outcome.kind === 'removed' ? 'status' : 'alert'}>{outcome.message}</p>}
      <Button type="button" className="border border-gray-300 bg-white text-gray-700" onClick={onClose}>
        닫기
      </Button>
    </section>
  );
}
