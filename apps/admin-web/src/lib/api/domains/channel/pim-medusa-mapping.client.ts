'use client';

// PIM masterId ↔ Medusa product id 매핑 조회 (channel-adapter, 읽기 전용)
//
// GA4 는 상품을 `item_id` 로 기록하고 그 값은 **Medusa product id** 다. 우리 통계는 masterId 로
// 도는 세계라, 둘을 잇지 않으면 상품 단건 화면에서 GA4 축이 통째로 빈다. 이름으로 이으면
// 개명·동명 상품에서 조용히 틀린다 — 매핑 표가 유일한 정답이다.
//
// 서버 응답은 envelope 이 아니라 `{ mappings: [...] }` 그대로다
// (apps/channel-adapter/src/controllers/pim-medusa-mapping.controller.ts).

import { CHANNEL_ADAPTER_SERVICE_BASE_URL } from '@/const';
import { client } from '../../client';

export interface PimMedusaMapping {
  pimMasterId: string;
  /** null = 동기화 실패 등으로 아직 Medusa 상품이 없음 */
  medusaProductId: string | null;
  medusaHandle: string | null;
  syncStatus: string | null;
  lastSyncedAt: string | null;
}

/** 서버가 강제하는 상한과 같은 값 — 넘겨 보내면 400 이다. */
export const MAPPING_LOOKUP_MAX_IDS = 100;

export const pimMedusaMappingClient = {
  list: async (masterIds: string[]): Promise<PimMedusaMapping[]> => {
    const ids = [...new Set(masterIds.filter(Boolean))];
    if (ids.length === 0) return [];
    const params = new URLSearchParams({ masterIds: ids.slice(0, MAPPING_LOOKUP_MAX_IDS).join(',') });
    const response = await client.get(
      `${CHANNEL_ADAPTER_SERVICE_BASE_URL}/adapter/pim-medusa-mappings?${params.toString()}`,
    );
    return response.data?.mappings ?? [];
  },
};
