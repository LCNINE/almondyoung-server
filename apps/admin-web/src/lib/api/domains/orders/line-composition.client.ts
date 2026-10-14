'use client';

// 판매주문 라인 구성(#1063) — 주문별 지정·상품매칭의 기존 출고 적용
import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import type {
  ApplyToExistingLinesResult,
  ExistingLinesImpact,
  LineCompositionChangeResponse,
  PutLineCompositionRequest,
} from '@/lib/types/dto/line-composition';
import { client } from '../../client';

const enc = encodeURIComponent;

// 셋 다 멱등이라(같은 구성 재전송 = 무변경, 적용 재전송 = «이미 같음») Idempotency-Key 없이 보낸다.
// client 는 키 없는 변경 요청을 재시도하지 않는다
export const lineCompositionClient = {
  assign: async (
    salesOrderId: string,
    salesOrderLineId: string,
    body: PutLineCompositionRequest
  ): Promise<LineCompositionChangeResponse> => {
    const response = await client.put(
      `${ALMONDYOUNG_API_BASE_URL}/sales-orders/${enc(salesOrderId)}/lines/${enc(salesOrderLineId)}/composition`,
      body
    );
    return response.data;
  },

  existingLinesImpact: async (variantId: string): Promise<ExistingLinesImpact> => {
    const response = await client.get(
      `${ALMONDYOUNG_API_BASE_URL}/matchings/variants/${enc(variantId)}/existing-lines-impact`
    );
    return response.data;
  },

  applyToExistingLines: async (variantId: string): Promise<ApplyToExistingLinesResult> => {
    const response = await client.post(
      `${ALMONDYOUNG_API_BASE_URL}/matchings/variants/${enc(variantId)}/apply-to-existing-lines`
    );
    return response.data;
  },
};
