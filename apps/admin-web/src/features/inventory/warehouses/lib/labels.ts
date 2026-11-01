import type { WarehouseDto } from '@/lib/types/dto/inventory';

export const WAREHOUSE_TYPES = ['domestic', 'overseas', 'bonded', 'return'] as const satisfies readonly WarehouseDto['type'][];

// 키를 목록에서 받는다 — 표가 `WarehouseDto['type']` 으로 이 표를 읽으므로, 타입이 늘었는데 목록에 없으면 컴파일이 깨진다.
export const WAREHOUSE_TYPE_LABELS: Record<(typeof WAREHOUSE_TYPES)[number], string> = {
  domestic: '국내',
  overseas: '해외',
  bonded: '보세',
  return: '반품',
};
