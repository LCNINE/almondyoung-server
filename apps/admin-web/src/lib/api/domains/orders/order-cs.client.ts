'use client';

import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import { client } from '../../client';
import { toCsContext, toOrderContacts } from './order-cs.shape';
import type { ContactOutcome, CsContext, OrderContact } from './order-cs.shape';

export interface CreateOrderContactRequest {
  /** 화면이 정한 요청 id — 다시 보내도 한 번만 남는다 */
  id: string;
  salesOrderId: string;
  outcome: ContactOutcome;
  body: string;
  followUpOn: string | null;
}

export const orderCsClient = {
  context: async (salesOrderId: string): Promise<CsContext> => {
    const response = await client.get(
      `${ALMONDYOUNG_API_BASE_URL}/order-progress/orders/${encodeURIComponent(salesOrderId)}/cs-context`
    );
    return toCsContext(response.data);
  },
  contacts: async (salesOrderId: string): Promise<OrderContact[]> => {
    const response = await client.get(
      `${ALMONDYOUNG_API_BASE_URL}/order-contacts/orders/${encodeURIComponent(salesOrderId)}`
    );
    return toOrderContacts(response.data);
  },
  createContact: async (data: CreateOrderContactRequest): Promise<void> => {
    await client.post(`${ALMONDYOUNG_API_BASE_URL}/order-contacts`, data);
  },
};
