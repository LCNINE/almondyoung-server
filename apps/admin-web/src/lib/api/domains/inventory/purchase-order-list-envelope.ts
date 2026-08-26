import type {
  PurchaseOrderDto,
  PurchaseOrderListResponseDto,
} from '../../../types/dto/inventory';

/**
 * 발주 목록 응답을 화면이 기대하는 `{ data, total }` 로 맞춘다.
 *
 * core 의 `GET /purchase-orders` 는 `Promise<PurchaseOrderResponse[]>` 다 — **envelope 이
 * 없다**(purchase-order.controller.ts). 그런데 admin-web 은 목록을 `{ data, total }` 로
 * 타이핑해두고 테이블이 `data?.data` 를 읽는다. 응답 인터셉터(api/client.ts)는 envelope 을
 * **벗기기만** 할 뿐 씌우지 않으므로, 감싸지 않으면 `data.data` 가 undefined 라
 * **발주 목록이 항상 빈 테이블**이 된다(#724 배경의 프론트 증상 2건 중 하나).
 *
 * 이미 `{ data, total }` 인 응답도 그대로 통과시킨다 — core 가 나중에 envelope 을 붙여도
 * 클라이언트를 다시 고치지 않아도 되게.
 *
 * ⚠️ bare array 경로의 `total` 은 **이번 페이지의 길이**다. core 가 전체 건수를 주지
 * 않으므로 그 이상은 알 수 없고, 따라서 첫 페이지 뒤로는 페이지네이션이 닿지 않는다.
 * 항구적 해법은 core 가 `{ data, total }` 을 반환하는 것이며 그건 API 계약 변경이다.
 */
export function normalizePurchaseOrderList(payload: unknown): PurchaseOrderListResponseDto {
  if (Array.isArray(payload)) {
    const data = payload as PurchaseOrderDto[];
    return { data, total: data.length };
  }

  if (payload && typeof payload === 'object' && Array.isArray((payload as { data?: unknown }).data)) {
    const enveloped = payload as PurchaseOrderListResponseDto;
    return { data: enveloped.data, total: enveloped.total ?? enveloped.data.length };
  }

  return { data: [], total: 0 };
}
