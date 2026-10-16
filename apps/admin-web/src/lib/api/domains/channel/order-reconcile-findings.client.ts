'use client';

// src/lib/api/domains/channel/order-reconcile-findings.client.ts
// «채널과 어긋남»(#1016 45번) API 클라이언트. 모양 맞추기는 전부 `./order-reconcile-findings.shape` 가 한다.
//
// shape 가 null 을 주면 여기서 throw 한다 — 쿼리가 isError 로 남아야 보드 칸이 «알 수 없음»(—)이 되고
// 목록이 «불러오지 못했습니다»가 된다. 0·빈 목록으로 흘리면 «정상»으로 읽힌다.

import { CHANNEL_ADAPTER_SERVICE_BASE_URL } from '@/const';
import { client } from '../../client';
import {
  MISMATCH_LIST_LIMIT,
  toClosedFinding,
  toMismatchList,
  toMismatchSummary,
  toRedeliverResult,
} from './order-reconcile-findings.shape';
import type {
  MismatchListResult,
  MismatchListScope,
  ReconcileFindingDto,
  ReconcileSummary,
} from './order-reconcile-findings.shape';

const BASE = `${CHANNEL_ADAPTER_SERVICE_BASE_URL}/adapter/order-reconcile-findings`;

function required<T>(value: T | null, what: string): T {
  if (value === null) throw new Error(`${what} 응답 모양이 예상과 다릅니다`);
  return value;
}

export const orderReconcileFindingsClient = {
  summary: async (): Promise<ReconcileSummary> => {
    const response = await client.get(`${BASE}/summary`);
    return required(toMismatchSummary(response.data), '어긋남 요약');
  },

  list: async (scope: MismatchListScope): Promise<MismatchListResult> => {
    const response = await client.get(BASE, {
      params: { status: scope, limit: MISMATCH_LIST_LIMIT },
    });
    return required(toMismatchList(response.data), '어긋남 목록');
  },

  /** 결과 문자열(`enqueued`·`not_found` …). 막히면 서버가 409 와 한국어 문구를 준다 */
  redeliver: async (id: string): Promise<string> => {
    const response = await client.post(
      `${BASE}/${encodeURIComponent(id)}/redeliver`
    );
    return required(toRedeliverResult(response.data), '다시 배달');
  },

  close: async (id: string, memo: string): Promise<ReconcileFindingDto> => {
    const response = await client.post(
      `${BASE}/${encodeURIComponent(id)}/close`,
      { memo }
    );
    return required(toClosedFinding(response.data), '종결');
  },
};
