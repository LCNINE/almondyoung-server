import { Link } from '@tanstack/react-router';
import { useWarehouse } from '../../app/warehouse-context';
import { newBatchSummary } from '../../domains/outbound/batchStatus';
import { useOutboundBatches } from '../../domains/outbound/queries';

/** 다른 탭에서 일하는 동안에는 30초마다 본다 — 배치 현황이 열려 있으면 그 화면의 10초 간격을 함께 쓴다 */
const WATCH_INTERVAL = 30_000;

/** 상단 탭 바의 «시작 전 배치 N개 · M상자». 관리자가 출고 준비로 만든 배치를 현장이 따로 전달받지 않아도 알게 한다 */
export function NewBatchNotice() {
  const { warehouseId } = useWarehouse();
  const created = useOutboundBatches(warehouseId, 'created', WATCH_INTERVAL);
  // 모든 탭 위에 붙는 알림이다 — 응답 모양이 어긋나도 셸 전체를 깨뜨리지 않고 알림만 숨긴다
  const { batches, boxes } = newBatchSummary(
    Array.isArray(created.data) ? created.data : undefined
  );
  if (batches === 0) return null;
  return (
    <Link
      to="/outbound/batches"
      className="flex items-center gap-1.5 rounded-full bg-[#1D5BD8] px-3 py-1 text-[13px] font-semibold text-white hover:bg-[#174AB0]"
    >
      <span aria-hidden className="h-2 w-2 rounded-full bg-white" />
      시작 전 배치 {batches}개{boxes !== null ? ` · ${boxes}상자` : ''}
    </Link>
  );
}
