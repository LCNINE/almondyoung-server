'use client';

import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import { client } from '../../client';
import type {
  BarcodeOwnerDto,
  CompleteFieldCaptureRequest,
  FieldCaptureDetailDto,
  FieldCaptureProgressDto,
  MyTodayDto,
  ShelfPositionDto,
} from '../../../types/dto/inventory';

const BASE = `${ALMONDYOUNG_API_BASE_URL}/inventory/sku-field-capture`;
const seg = encodeURIComponent;

export const skuFieldCaptureClient = {
  getPosition: async (code: string): Promise<ShelfPositionDto> =>
    (await client.get(`${BASE}/positions/${seg(code)}`)).data,
  getDetail: async (skuId: string): Promise<FieldCaptureDetailDto> =>
    (await client.get(`${BASE}/skus/${seg(skuId)}`)).data,
  getBarcodeOwner: async (barcode: string): Promise<{ owner: BarcodeOwnerDto | null }> =>
    (await client.get(`${BASE}/barcodes/${seg(barcode)}/owner`)).data,
  attachPhoto: async (skuId: string, fileId: string): Promise<FieldCaptureDetailDto> =>
    (await client.post(`${BASE}/skus/${seg(skuId)}/photos`, { fileId })).data,
  removePhoto: async (skuId: string, photoId: string): Promise<FieldCaptureDetailDto> =>
    (await client.delete(`${BASE}/skus/${seg(skuId)}/photos/${seg(photoId)}`)).data,
  complete: async (skuId: string, body: CompleteFieldCaptureRequest): Promise<FieldCaptureDetailDto> =>
    (await client.put(`${BASE}/skus/${seg(skuId)}/capture`, body)).data,
  getMyToday: async (): Promise<MyTodayDto> => (await client.get(`${BASE}/me/today`)).data,
  getProgress: async (): Promise<FieldCaptureProgressDto> => (await client.get(`${BASE}/progress`)).data,
};
