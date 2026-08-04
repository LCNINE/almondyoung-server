'use client';

import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import type {
  BulkImageStatus,
  BulkItemStatus,
  BulkPublishStatus,
  BulkSessionAccepted,
  BulkSessionImageList,
  BulkSessionItem,
  BulkSessionItemList,
  BulkSessionList,
  BulkSessionProgress,
  ConflictDecision,
  ConflictFilter,
  PurgeDraftsResult,
  ResolveImageEntry,
  ResolveImagesResponse,
} from '@/lib/types/dto/bulk-session';
import { client } from '../../client';
import { fetchWithRefresh } from '../../fetch-with-refresh';

const BASE = `${ALMONDYOUNG_API_BASE_URL}/product-bulk-sessions`;

// raw fetch 용 절대경로. axios `client` 의 baseURL('/api')이 붙지 않으므로 직접 합친다.
const RAW_BASE = `/api${BASE}`;

export const bulkSessionClient = {
  /**
   * 워크북 업로드.
   *
   * axios `client` 를 쓰지 않는다 — 인스턴스가 'Content-Type: application/json' 을
   * 기본값으로 박아 두어 FormData 의 multipart boundary 가 붙지 않는다.
   * upload.client.ts 가 같은 이유로 같은 선택을 했다.
   */
  upload: async (file: File, name?: string): Promise<BulkSessionAccepted> => {
    const form = new FormData();
    form.append('file', file);
    if (name) form.append('name', name);

    const res = await fetchWithRefresh(RAW_BASE, {
      method: 'POST',
      body: form, // Content-Type 은 브라우저가 boundary 와 함께 자동 설정 — 직접 지정 금지
      credentials: 'include',
    });
    if (!res.ok) {
      // 서버 메시지를 그대로 살려 올린다 — 화면이 400 을 "양식 만료"로 옮겨 읽는다.
      // res.json() 은 타입 정보가 없는 원시 fetch 응답이라 명시적으로 좁혀준다(any 전파 방지).
      const body = (await res.json().catch(() => null)) as {
        message?: string;
      } | null;
      const error = new Error(body?.message ?? '업로드에 실패했습니다.');
      Object.assign(error, {
        statusCode: res.status,
        response: { status: res.status, data: body },
      });
      throw error;
    }
    return (await res.json()) as BulkSessionAccepted;
  },

  list: async (page: number, limit: number): Promise<BulkSessionList> =>
    (await client.get(BASE, { params: { page, limit } })).data,

  getProgress: async (id: string): Promise<BulkSessionProgress> =>
    (await client.get(`${BASE}/${id}`)).data,

  getItems: async (
    id: string,
    query: {
      status?: BulkItemStatus;
      conflict?: ConflictFilter;
      publishStatus?: BulkPublishStatus;
      page: number;
      limit: number;
    }
  ): Promise<BulkSessionItemList> =>
    (await client.get(`${BASE}/${id}/items`, { params: query })).data,

  setConflictDecision: async (
    id: string,
    itemId: string,
    decisions: Record<string, ConflictDecision>
  ): Promise<BulkSessionItem> =>
    (
      await client.patch(`${BASE}/${id}/items/${itemId}/conflict-decision`, {
        decisions,
      })
    ).data,

  approve: async (id: string): Promise<BulkSessionProgress> =>
    (await client.post(`${BASE}/${id}/approve`)).data,

  cancel: async (id: string): Promise<BulkSessionProgress> =>
    (await client.post(`${BASE}/${id}/cancel`)).data,

  publish: async (id: string): Promise<BulkSessionProgress> =>
    (await client.post(`${BASE}/${id}/publish`)).data,

  retryDraft: async (id: string): Promise<BulkSessionProgress> =>
    (await client.post(`${BASE}/${id}/retry-draft`)).data,

  excludeItem: async (id: string, itemId: string): Promise<BulkSessionItem> =>
    (await client.post(`${BASE}/${id}/items/${itemId}/exclude`)).data,

  purgeDrafts: async (id: string): Promise<PurgeDraftsResult> =>
    (await client.post(`${BASE}/${id}/purge-drafts`)).data,

  getImages: async (
    id: string,
    query: {
      status?: BulkImageStatus;
      onlyRequired?: boolean;
      page: number;
      limit: number;
    }
  ): Promise<BulkSessionImageList> =>
    (await client.get(`${BASE}/${id}/images`, { params: query })).data,

  resolveImages: async (
    id: string,
    resolutions: ResolveImageEntry[]
  ): Promise<ResolveImagesResponse> =>
    (await client.post(`${BASE}/${id}/images/resolve`, { resolutions })).data,
};
