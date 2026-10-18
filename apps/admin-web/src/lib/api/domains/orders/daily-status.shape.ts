// src/lib/api/domains/orders/daily-status.shape.ts
//
// 일별 주문처리 현황 응답 정규화. admin-web 이 core 보다 새로 뜨거나 core 만 롤백되면 `series[]` 에
// `externalShipped` 가 없다 — 그대로 두면 보드가 `undefined.toLocaleString` 으로 죽고 합계가 NaN 이 된다.
// «외부 출고 0건» 과 «옛 응답» 은 화면에서 구별할 이유가 없으므로 0 으로 채운다.

import type { DailyOrderStatusDto } from '@/lib/types/dto/orders';

export function normalizeDailyOrderStatus(raw: DailyOrderStatusDto): DailyOrderStatusDto {
  return {
    ...raw,
    series: (raw.series ?? []).map((point) => ({
      ...point,
      externalShipped: point.externalShipped ?? 0,
    })),
  };
}
