import { loadFailed } from '../../core/data/loadFailed';
import { LoadFailure } from '../../core/design/LoadFailure';
import { formatTrackingNo } from '../../domains/outbound/inspection';
import { usePendingRefills } from '../../domains/outbound/refills';

/**
 * 보충 대기(스펙 §7.3) — 결품을 다른 위치에서 채웠고 그 몫을 아직 안 집은 박스. 창고 단위 서버 조회라 어느 스테이션에서 봐도 같다.
 * 비었으면 그리지 않는다. 조회가 실패하면 빈 것처럼 숨기지 않고 알린다 — 이미 읽은 목록은 남긴다.
 * 이어 하기 = 새 송장 스캔 — 따로 누를 것이 없다.
 */
export function RefillPanel({ warehouseId }: { warehouseId: string }) {
  const refills = usePendingRefills(warehouseId);
  const boxes = refills.data ?? [];
  const failed = loadFailed(refills);
  if (boxes.length === 0 && !failed) return null;
  return (
    <section aria-label="보충 대기" className="shrink-0 overflow-hidden rounded-[10px] border-2 border-[#D99A00] bg-white">
      <div className="flex h-10 items-center gap-2.5 bg-[#FFF1C7] px-4 text-[15px] font-bold text-[#5E3B00]">
        보충 대기 {refills.data ? <span className="font-mono">{boxes.length}</span> : null}
      </div>
      {failed ? (
        <LoadFailure
          className="px-4 py-2 text-[15px]"
          message="보충 대기를 불러오지 못했어요."
          error={refills.error}
          stale={boxes.length > 0}
          retrying={refills.isFetching}
          onRetry={() => void refills.refetch()}
        />
      ) : null}
      <ol className="px-4 text-base">
        {boxes.map((box) => (
          <li
            key={box.shipmentId}
            className="grid min-h-12 grid-cols-[170px_80px_minmax(0,1fr)] items-center border-b border-[#EEF0F2] last:border-b-0"
          >
            <span className="font-mono">{box.trackingNo ? formatTrackingNo(box.trackingNo) : '—'}</span>
            <span>{box.recipientMasked}</span>
            <span>
              {box.items.map((item) => (
                <span key={`${item.shipmentLineId}-${item.sourceLocationId}`} className="mr-3 inline-block">
                  <span className="font-mono font-semibold">[{item.locationCode}]</span> <span>{item.skuName}</span>{' '}
                  <span className="font-mono font-semibold">×{item.qty}</span>
                </span>
              ))}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
