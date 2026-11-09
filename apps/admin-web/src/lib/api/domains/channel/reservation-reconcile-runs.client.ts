'use client';

// src/lib/api/domains/channel/reservation-reconcile-runs.client.ts
// «Medusa 예약 대사»(#1247) 멈춘 회차 API 클라이언트. 모양 맞추기는 `.shape` 가 하고,
// null 이면 throw 한다 — 빈 목록으로 흘리면 «멈춘 것 없음»으로 읽힌다.

import { CHANNEL_ADAPTER_SERVICE_BASE_URL } from '@/const';
import { client } from '../../client';
import {
  toReconcileRun,
  toReconcileRunsOverview,
} from './reservation-reconcile-runs.shape';
import type {
  ReconcileRunDto,
  ReconcileRunsOverview,
} from './reservation-reconcile-runs.shape';

const BASE = `${CHANNEL_ADAPTER_SERVICE_BASE_URL}/adapter/reservation-reconcile-runs`;

function required<T>(value: T | null, what: string): T {
  if (value === null) throw new Error(`${what} 응답 모양이 예상과 다릅니다`);
  return value;
}

export const reservationReconcileRunsClient = {
  overview: async (): Promise<ReconcileRunsOverview> => {
    const response = await client.get(BASE);
    return required(toReconcileRunsOverview(response.data), '예약 대사 회차');
  },

  /**
   * 202 — 한도 없이 도는 새 회차를 뒤에서 시작하고 그 회차(running)를 돌려준다(회차는 정착 대기만 5분이라
   * 끝까지 기다리면 프록시 30초에 끊긴다). 새 회차가 applied 로 끝날 때만 원래 회차가 닫힌다. 도는 회차가 있으면 409.
   */
  apply: async (id: string): Promise<ReconcileRunDto> => {
    const response = await client.post(
      `${BASE}/${encodeURIComponent(id)}/apply`
    );
    return required(toReconcileRun(response.data), '예약 대사 고치기');
  },

  close: async (id: string, reason: string): Promise<ReconcileRunDto> => {
    const response = await client.post(
      `${BASE}/${encodeURIComponent(id)}/close`,
      { reason }
    );
    return required(toReconcileRun(response.data), '예약 대사 종결');
  },
};
