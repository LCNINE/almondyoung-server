import { formatInTimeZone } from 'date-fns-tz';
import { DirectShipCancelNotice } from './direct-ship-cancel-notice.types';

const HEADERS = ['판매주문ID', '주문라인ID', '상품명', '취소수량', '공급사SKU', '취소구분', '취소일시', '취소ID'];

/** 업체가 넘길 때 받은 엑셀과 같은 키(판매주문ID·주문라인ID)로 찾는다 — 고객 정보는 싣지 않는다(N27). 셀 이스케이프는 직배 주문 CSV 와 같은 꼴. */
export function toCancelNoticeCsv(rows: DirectShipCancelNotice[]): string {
  const body = rows.map((r) => [
    r.salesOrderId,
    r.salesOrderLineId ?? '',
    r.skuName,
    String(r.canceledQty),
    r.supplierSku ?? '',
    r.cancellationScope === 'full' ? '전체' : '부분',
    formatInTimeZone(r.cancelledAt, 'Asia/Seoul', 'yyyy-MM-dd HH:mm'),
    r.orderCancellationId ?? '',
  ]);
  return [HEADERS, ...body].map((row) => row.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
}
