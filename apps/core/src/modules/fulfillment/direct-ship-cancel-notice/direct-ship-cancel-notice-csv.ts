import { formatInTimeZone } from 'date-fns-tz';
import { DirectShipCancelNotice } from './direct-ship-cancel-notice.types';
import { SUPPLIER_SHEET_COLUMNS, SupplierSheetKey } from '../supplier-shipment/supplier-sheet.columns';

const sheetHeader = (key: SupplierSheetKey): string => {
  const column = SUPPLIER_SHEET_COLUMNS.find((c) => c.key === key);
  if (!column) throw new Error(`Supplier sheet column ${key} is missing`);
  return column.header;
};

// 앞 넷은 입점사가 받은 시트의 머리글 그대로 — 입점사가 그 시트에서 같은 행을 찾는다(K3 PR6 N7)
const HEADERS = [
  sheetHeader('rowKey'),
  sheetHeader('orderNo'),
  sheetHeader('productName'),
  sheetHeader('supplierSku'),
  '취소수량',
  '취소구분',
  '취소일시',
  '취소ID',
];

/** 입점사가 받은 시트와 같은 키(행 키 = FOI id·주문번호)로 찾는다 — 고객 정보는 싣지 않는다(N27). 셀 이스케이프는 직배 주문 CSV 와 같은 꼴. */
export function toCancelNoticeCsv(rows: DirectShipCancelNotice[]): string {
  const body = rows.map((r) => [
    r.fulfillmentOrderItemId,
    r.orderNo,
    r.skuName,
    r.supplierSku ?? '',
    String(r.canceledQty),
    r.cancellationScope === 'full' ? '전체' : '부분',
    formatInTimeZone(r.cancelledAt, 'Asia/Seoul', 'yyyy-MM-dd HH:mm'),
    r.orderCancellationId ?? '',
  ]);
  return [HEADERS, ...body].map((row) => row.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
}
