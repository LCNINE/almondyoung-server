'use client';

// src/lib/api/domains/orders/direct-ship.client.ts
// 직배 운영 — 입점사 상자(K3). 옛 업체 이름 라우트(`/orders`·`/companies`·`/export`)는 부르지 않는다(K3 PR7 N6).
import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import { parsePiiHeaders, type PiiMeta } from '@/lib/pii/pii-notices';
import type {
  DirectShipCancelNotice,
  SupplierHandoffSummary,
  SupplierQueueShipment,
  SupplierQueueStage,
  SupplierQueueSummary,
  SupplierSheet,
  SupplierSheetApplyResult,
  SupplierSheetPreview,
} from '@/lib/types/dto/fulfillment';
import { client } from '../../client';
import { fetchWithRefresh } from '../../fetch-with-refresh';

const BASE = `${ALMONDYOUNG_API_BASE_URL}/direct-ship`;

// raw fetch 용 절대경로. axios `client` 의 baseURL('/api')이 붙지 않으므로 직접 합친다.
const RAW_BASE = `/api${BASE}`;

/** 시트 응답 — 가려 왔는지(`x-pii-*`)를 함께 돌려준다. 가린 시트는 파일로 만들지 않는다(N3). */
export interface SheetResponse {
  sheet: SupplierSheet;
  pii: PiiMeta | null;
}

type HeaderBag = Record<string, unknown>;

function toSheetResponse(res: { data: SupplierSheet; headers: HeaderBag }): SheetResponse {
  // axios 응답 헤더 이름은 소문자다
  const pii = parsePiiHeaders((name) => {
    const value = res.headers[name];
    return typeof value === 'string' ? value : undefined;
  });
  return { sheet: res.data, pii };
}

/** 서버는 `decodeURIComponent` 로 읽는다 — 한글 사유가 헤더에 실리도록 인코딩한다 */
const reasonHeader = (reason: string) => ({
  'x-pii-export-reason': encodeURIComponent(reason),
});

/**
 * 시트 올리기.
 *
 * axios `client` 를 쓰지 않는다 — 인스턴스가 'Content-Type: application/json' 을
 * 기본값으로 박아 두어 FormData 의 multipart boundary 가 붙지 않는다(bulk-session.client.ts 와 같은 선택).
 */
async function postWorkbook<T>(path: string, form: FormData): Promise<T> {
  const res = await fetchWithRefresh(`${RAW_BASE}${path}`, {
    method: 'POST',
    body: form, // Content-Type 은 브라우저가 boundary 와 함께 자동 설정 — 직접 지정 금지
    credentials: 'include',
  });
  if (!res.ok) {
    // 서버 메시지·코드를 그대로 살려 올린다 — 화면이 409 STALE 을 «다시 미리보기» 로 옮겨 읽는다.
    const body = (await res.json().catch(() => null)) as {
      message?: string;
      code?: string;
    } | null;
    const error = new Error(body?.message ?? '업로드에 실패했습니다.');
    Object.assign(error, {
      statusCode: res.status,
      response: { status: res.status, data: body },
    });
    throw error;
  }
  return (await res.json()) as T;
}

export const directShipClient = {
  getSupplierQueue: async (): Promise<SupplierQueueSummary[]> => {
    const res = await client.get(`${BASE}/supplier-queue`);
    return res.data;
  },

  getSupplierShipments: async (
    supplierId: string,
    stage: SupplierQueueStage
  ): Promise<SupplierQueueShipment[]> => {
    const res = await client.get(
      `${BASE}/supplier-queue/${encodeURIComponent(supplierId)}/shipments`,
      { params: { stage } }
    );
    return res.data;
  },

  getSupplierHandoffs: async (supplierId: string): Promise<SupplierHandoffSummary[]> => {
    const res = await client.get(
      `${BASE}/suppliers/${encodeURIComponent(supplierId)}/handoffs`
    );
    return res.data;
  },

  handOff: async (supplierId: string, reason: string): Promise<SheetResponse> => {
    const res = await client.post<SupplierSheet>(
      `${BASE}/suppliers/${encodeURIComponent(supplierId)}/handoffs`,
      undefined,
      { headers: reasonHeader(reason) }
    );
    return toSheetResponse(res);
  },

  getHandoffSheet: async (handoffId: string, reason: string): Promise<SheetResponse> => {
    const res = await client.get<SupplierSheet>(
      `${BASE}/handoffs/${encodeURIComponent(handoffId)}/sheet`,
      { headers: reasonHeader(reason) }
    );
    return toSheetResponse(res);
  },

  previewUpload: async (supplierId: string, file: File): Promise<SupplierSheetPreview> => {
    const form = new FormData();
    form.append('file', file);
    return postWorkbook<SupplierSheetPreview>(
      `/suppliers/${encodeURIComponent(supplierId)}/uploads/preview`,
      form
    );
  },

  applyUpload: async (
    supplierId: string,
    file: File,
    previewToken: string
  ): Promise<SupplierSheetApplyResult> => {
    const form = new FormData();
    form.append('file', file);
    form.append('previewToken', previewToken);
    return postWorkbook<SupplierSheetApplyResult>(
      `/suppliers/${encodeURIComponent(supplierId)}/uploads/apply`,
      form
    );
  },

  getCancelNotices: async (supplierId?: string): Promise<DirectShipCancelNotice[]> => {
    const res = await client.get(`${BASE}/cancel-notices`, {
      params: supplierId ? { supplierId } : undefined,
    });
    return res.data;
  },

  exportCancelNoticesFile: async (data: {
    supplierId: string;
    noticeIds: string[];
  }): Promise<Blob> => {
    const res = await client.post(
      `${BASE}/cancel-notices/export/file`,
      data,
      { responseType: 'blob' }
    );
    return res.data;
  },

  markCancelNoticesNotified: async (data: {
    supplierId: string;
    noticeIds: string[];
  }): Promise<{ notified: number }> => {
    const res = await client.post(`${BASE}/cancel-notices/notified`, data);
    return res.data;
  },
};
