'use client';

import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import { client } from '../../client';
import type {
  CancelInboundShipmentResult,
  CloseInboundShipmentResult,
  ConfirmInboundShipmentBody,
  ConfirmInboundShipmentResult,
  ReopenInboundShipmentResult,
  EditInboundShipmentBoxBody,
  EditInboundShipmentLineBody,
  InboundShipmentDetail,
  InboundShipmentListFilter,
  InboundShipmentSummary,
  UpdateInboundShipmentHeaderBody,
  UploadInboundShipmentBody,
} from '../../../types/dto/inbound-shipment';

const BASE = `${ALMONDYOUNG_API_BASE_URL}/inventory/inbound-shipments`;

export const inboundShipmentsClient = {
  list: async (
    filter: InboundShipmentListFilter = {}
  ): Promise<InboundShipmentSummary[]> => {
    const params: Record<string, string> = {};
    if (filter.status?.length) params.status = filter.status.join(',');
    if (filter.warehouseId) params.warehouseId = filter.warehouseId;
    const response = await client.get(BASE, { params });
    return response.data;
  },

  detail: async (id: string): Promise<InboundShipmentDetail> => {
    const response = await client.get(`${BASE}/${id}`);
    return response.data;
  },

  upload: async (
    body: UploadInboundShipmentBody
  ): Promise<{ shipmentId: string }> => {
    const response = await client.post(BASE, body);
    return response.data;
  },

  updateHeader: async (
    id: string,
    body: UpdateInboundShipmentHeaderBody
  ): Promise<{ shipmentId: string }> => {
    const response = await client.patch(`${BASE}/${id}`, body);
    return response.data;
  },

  editLine: async (
    id: string,
    lineId: string,
    body: EditInboundShipmentLineBody
  ): Promise<{ lineId: string }> => {
    const response = await client.patch(`${BASE}/${id}/lines/${lineId}`, body);
    return response.data;
  },

  editBox: async (
    id: string,
    boxId: string,
    body: EditInboundShipmentBoxBody
  ): Promise<{ boxId: string }> => {
    const response = await client.patch(`${BASE}/${id}/boxes/${boxId}`, body);
    return response.data;
  },

  confirm: async (
    id: string,
    body: ConfirmInboundShipmentBody
  ): Promise<ConfirmInboundShipmentResult> => {
    const response = await client.post(`${BASE}/${id}/confirm`, body);
    return response.data;
  },

  cancel: async (id: string): Promise<CancelInboundShipmentResult> => {
    const response = await client.post(`${BASE}/${id}/cancel`);
    return response.data;
  },

  close: async (
    id: string,
    body: { reason: string }
  ): Promise<CloseInboundShipmentResult> => {
    const response = await client.post(`${BASE}/${id}/close`, body);
    return response.data;
  },

  reopen: async (id: string): Promise<ReopenInboundShipmentResult> => {
    const response = await client.post(`${BASE}/${id}/reopen`);
    return response.data;
  },
};
