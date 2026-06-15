'use client';

// src/lib/api/domains/orders/invoices.client.ts
import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import { client } from '../../client';
import type {
  IssueInvoiceRequest,
  IssueInvoiceResponse,
  PrintInvoicesRequest,
  PrintInvoicesResponse,
  InvoiceDetail,
  TrackInvoiceResponse,
} from '@/lib/types/dto/fulfillment';

const BASE = `${ALMONDYOUNG_API_BASE_URL}/invoices`;

export const invoicesClient = {
  issue: async (data: IssueInvoiceRequest): Promise<IssueInvoiceResponse> => {
    const res = await client.post(BASE, data);
    return res.data;
  },

  getDetail: async (id: string): Promise<InvoiceDetail> => {
    // ⚠️ 서버 getInvoiceDetail 응답의 items가 빈 배열로 반환됨.
    // 라인아이템 표시가 필요하면 FO 라인을 별도 조회로 보강해야 함.
    const res = await client.get(`${BASE}/${encodeURIComponent(id)}`);
    return res.data;
  },

  print: async (data: PrintInvoicesRequest): Promise<PrintInvoicesResponse> => {
    // 응답의 printUri를 window.open으로 열어 provider(한진/Goodsflow) 인쇄 페이지를 표시.
    // ⚠️ direct/self 방식 송장만 포함되거나, 서로 다른 provider 송장이 섞이면 BadRequest 발생.
    const res = await client.post(`${BASE}/print`, data);
    return res.data;
  },

  ship: async (id: string): Promise<{ message: string }> => {
    // provider(hanjin/goodsflow): 'printed' 상태만 허용. direct/self: 'issued' 또는 'printed' 상태에서 허용.
    const res = await client.put(`${BASE}/${encodeURIComponent(id)}/ship`);
    return res.data;
  },

  cancel: async (id: string): Promise<{ message: string }> => {
    const res = await client.put(`${BASE}/${encodeURIComponent(id)}/cancel`);
    return res.data;
  },

  track: async (id: string): Promise<TrackInvoiceResponse> => {
    // ⚠️ provider(hanjin/goodsflow) 방식만 지원. direct/self는 서버에서 BadRequest 반환.
    const res = await client.get(`${BASE}/${encodeURIComponent(id)}/track`);
    return res.data;
  },
};
