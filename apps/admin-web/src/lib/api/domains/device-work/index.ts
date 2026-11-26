'use client';

// 물류앱 기기에 결과를 모른 채 남은 작업. 응답은 envelope 없이 오므로 `response.data` 가 곧 본문이다.

import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import { client } from '../../client';

/**
 * 서버 요청 키 기록으로 본 판정
 * - applied 반영됨 · rejected 서버가 받고 반영하지 않음 · abandoned 버림
 * - in_progress 서버가 처리 중 · not_applied 서버에 없음 · expired 보관 기간이 지나 판정 불가
 */
export type DeviceWorkVerdict =
  | 'applied'
  | 'rejected'
  | 'abandoned'
  | 'in_progress'
  | 'not_applied'
  | 'expired';

export interface DeviceWorkItem {
  operationKey: string;
  deviceId: string;
  deviceKind: 'station' | 'handheld';
  workerName: string | null;
  workName: string;
  summary: string | null;
  path: string;
  deviceStatus: string;
  attempts: number;
  errorCode: string | null;
  recordedAt: string;
  lastReportedAt: string;
  verdict: DeviceWorkVerdict;
}

export type DeviceWorkAction = 'abandon' | 'dismiss';

const BASE = `${ALMONDYOUNG_API_BASE_URL}/inventory/device-work`;

export const deviceWorkClient = {
  list: async (): Promise<DeviceWorkItem[]> =>
    (await client.get<{ items: DeviceWorkItem[] }>(BASE)).data.items,
  resolve: async (
    operationKey: string,
    action: DeviceWorkAction
  ): Promise<{ operationKey: string; resolution: 'abandoned' | 'dismissed' }> =>
    (
      await client.post<{
        operationKey: string;
        resolution: 'abandoned' | 'dismissed';
      }>(`${BASE}/${encodeURIComponent(operationKey)}/resolve`, { action })
    ).data,
};
