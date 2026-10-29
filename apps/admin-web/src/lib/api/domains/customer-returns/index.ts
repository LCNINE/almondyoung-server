'use client';

import { ALMONDYOUNG_API_BASE_URL, MEDUSA_BASE_URL } from '@/const';
import { client } from '../../client';
import type {
  CancelOrderReturnResult,
  CloseCustomerReturnMissingBody,
  CustomerReturnListPage,
  CustomerReturnListQuery,
  CustomerReturnView,
  OrderReturnable,
  RequestCustomerReturnPrepayBody,
  RequestOrderReturnBody,
  RequestOrderReturnResult,
  RestartCustomerReturnBody,
  ReturnSettlementPreview,
  SettleHeldCustomerReturnBody,
} from '../../../types/dto/customer-returns';

const CORE = `${ALMONDYOUNG_API_BASE_URL}/admin/customer-returns`;

function listQs(q: CustomerReturnListQuery): string {
  const sp = new URLSearchParams();
  sp.set('bucket', q.bucket);
  if (q.q?.trim()) sp.set('q', q.q.trim());
  if (q.limit !== undefined) sp.set('limit', String(q.limit));
  if (q.offset !== undefined) sp.set('offset', String(q.offset));
  return sp.toString();
}

/** 새 반품 기록 — 목록·상세·CS 문은 core, 접수·도착 전 취소·정산 미리보기는 Medusa (K8 PR7 N1) */
export const customerReturnApi = {
  // ---- core ----
  list: async (q: CustomerReturnListQuery): Promise<CustomerReturnListPage> => {
    const res = await client.get(`${CORE}?${listQs(q)}`);
    return res.data;
  },

  get: async (id: string): Promise<CustomerReturnView> => {
    const res = await client.get(`${CORE}/${encodeURIComponent(id)}`);
    return res.data;
  },

  closeMissing: async (id: string, body: CloseCustomerReturnMissingBody): Promise<CustomerReturnView> => {
    const res = await client.post(`${CORE}/${encodeURIComponent(id)}/missing-closure`, body);
    return res.data;
  },

  settleHeld: async (id: string, body: SettleHeldCustomerReturnBody): Promise<CustomerReturnView> => {
    const res = await client.post(`${CORE}/${encodeURIComponent(id)}/held-settlement`, body);
    return res.data;
  },

  requestPrepay: async (id: string, body: RequestCustomerReturnPrepayBody): Promise<CustomerReturnView> => {
    const res = await client.post(`${CORE}/${encodeURIComponent(id)}/prepayment`, body);
    return res.data;
  },

  /** 거절·멈춘 정산/선환불을 다시 낸다. retry 만 본문을 받는다(이미 환불한 금액·보류 차감 빼기) */
  restart: async (
    id: string,
    target: 'settlement' | 'prepayment',
    kind: 'retry' | 'manual',
    body?: RestartCustomerReturnBody
  ): Promise<CustomerReturnView> => {
    const path = kind === 'retry' ? 'retry' : 'manual-refund';
    const res = await client.post(`${CORE}/${encodeURIComponent(id)}/${target}/${path}`, body ?? {});
    return res.data;
  },

  /** 회수(한진) 예약을 다시 접수한다. 받을 수 없는 상태면 서버가 409 로 문구를 준다 */
  retryPickup: async (id: string): Promise<CustomerReturnView> => {
    const res = await client.post(`${CORE}/${encodeURIComponent(id)}/pickup/retry`);
    return res.data;
  },

  /**
   * 교환품 보내기(K8 PR11) — 교환 상자를 연다. 보류면 정산도 열고, 수령 전이면 먼저 보낸다(선발송). 이미 열렸으면 그대로.
   * 반품이면 400, 보류·수령 전이 아니면 409 — 서버 문구를 그대로 토스트한다
   */
  releaseExchange: async (id: string): Promise<CustomerReturnView> => {
    const res = await client.post(`${CORE}/${encodeURIComponent(id)}/exchange-release`);
    return res.data;
  },

  // ---- Medusa ----
  returnable: async (orderId: string): Promise<OrderReturnable> => {
    const res = await client.get<OrderReturnable>(
      `${MEDUSA_BASE_URL}/admin/orders/${encodeURIComponent(orderId)}/returnable`
    );
    return res.data;
  },

  request: async (orderId: string, body: RequestOrderReturnBody): Promise<RequestOrderReturnResult> => {
    const res = await client.post<RequestOrderReturnResult>(
      `${MEDUSA_BASE_URL}/admin/orders/${encodeURIComponent(orderId)}/returns`,
      body
    );
    return res.data;
  },

  cancel: async (orderId: string, returnId: string): Promise<CancelOrderReturnResult> => {
    const res = await client.post<CancelOrderReturnResult>(
      `${MEDUSA_BASE_URL}/admin/orders/${encodeURIComponent(orderId)}/returns/${encodeURIComponent(returnId)}/cancel`
    );
    return res.data;
  },

  settlementPreview: async (orderId: string, returnId: string): Promise<ReturnSettlementPreview> => {
    const res = await client.get<ReturnSettlementPreview>(
      `${MEDUSA_BASE_URL}/admin/orders/${encodeURIComponent(orderId)}/returns/${encodeURIComponent(returnId)}/settlement-preview`
    );
    return res.data;
  },
};
