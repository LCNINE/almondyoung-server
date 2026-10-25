/**
 * 직배 시트 열 정의 — core 한 곳 (K3 PR5, N2). 내려받기와 올리기 파서가 같은 상수를 읽는다.
 * 머리글은 입점사가 보는 한국어이고, 파서는 위치가 아니라 머리글 글자로 찾는다.
 */
export type SupplierSheetKey =
  | 'rowKey'
  | 'orderNo'
  | 'productName'
  | 'supplierSku'
  | 'qty'
  | 'recipientName'
  | 'recipientPhone'
  | 'address'
  | 'entrancePassword'
  | 'deliveryMemo'
  | 'carrier'
  | 'trackingNo'
  | 'unfulfillableReason';

export const SUPPLIER_SHEET_COLUMNS: readonly { key: SupplierSheetKey; header: string }[] = [
  { key: 'rowKey', header: '행 키(지우지 마세요)' },
  { key: 'orderNo', header: '주문번호' },
  { key: 'productName', header: '상품명' },
  { key: 'supplierSku', header: '공급사 상품코드' },
  { key: 'qty', header: '수량' },
  { key: 'recipientName', header: '수령인' },
  { key: 'recipientPhone', header: '연락처' },
  { key: 'address', header: '주소' },
  { key: 'entrancePassword', header: '공동현관 비밀번호' },
  { key: 'deliveryMemo', header: '배송 메모' },
  { key: 'carrier', header: '택배사' },
  { key: 'trackingNo', header: '송장번호' },
  { key: 'unfulfillableReason', header: '못 보냄 사유' },
];
