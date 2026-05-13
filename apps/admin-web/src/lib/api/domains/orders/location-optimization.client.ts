'use client';

// src/lib/api/domains/orders/location-optimization.client.ts
// ⚠️ routes/optimize, routes/batches/:id, statistics/warehouses/:id 모두 pending_development
//    zones/configuration만 실제 데이터 반환 — 나머지 함수는 추후 서버 구현 후 사용
import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import { client } from '../../client';
import type { LocationOptimizationZone } from '@/lib/types/dto/fulfillment';

const BASE = `${ALMONDYOUNG_API_BASE_URL}/location-optimization`;

export const locationOptimizationClient = {
  getZones: async (): Promise<{ zones: LocationOptimizationZone[]; note: string }> => {
    const res = await client.get(`${BASE}/zones/configuration`);
    return res.data;
  },
};
