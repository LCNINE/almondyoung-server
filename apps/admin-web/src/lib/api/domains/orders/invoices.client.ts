'use client';

// src/lib/api/domains/orders/invoices.client.ts
import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import { client } from '../../client';
import type {
  IssueShipmentInvoiceRequest,
  VoidShipmentInvoiceRequest,
  InvoiceOperation,
} from '@/lib/types/dto/fulfillment';

const BASE = `${ALMONDYOUNG_API_BASE_URL}/invoices`;

export const invoicesClient = {
  issueForShipment: async (
    shipmentId: string,
    data: IssueShipmentInvoiceRequest,
    idempotencyKey: string
  ): Promise<InvoiceOperation> => {
    const res = await client.post(
      `${ALMONDYOUNG_API_BASE_URL}/shipments/${encodeURIComponent(shipmentId)}/invoices`,
      data,
      { headers: { 'Idempotency-Key': idempotencyKey } }
    );
    return res.data;
  },

  voidShipmentInvoice: async (
    invoiceId: string,
    data: VoidShipmentInvoiceRequest,
    idempotencyKey: string
  ): Promise<InvoiceOperation> => {
    const res = await client.post(
      `${BASE}/${encodeURIComponent(invoiceId)}/void`,
      data,
      { headers: { 'Idempotency-Key': idempotencyKey } }
    );
    return res.data;
  },

  getOperation: async (operationId: string): Promise<InvoiceOperation> => {
    const res = await client.get(
      `${ALMONDYOUNG_API_BASE_URL}/invoice-operations/${encodeURIComponent(operationId)}`
    );
    return res.data;
  },
};
