'use client';

import { NOTIFICATION_SERVICE_BASE_URL } from '@/const';
import { client } from '../../client';

export interface SmsDeviceStatus {
  id: string;
  deviceId: string;
  name: string;
  enabled: boolean;
  dailyLimit: number;
  sentToday: number;
  lastSeen: string | null;
  online: boolean;
}

export interface SmsDeviceListResponse {
  devices: SmsDeviceStatus[];
  pendingCount: number;
}

export interface SmsDeviceFormValues {
  deviceId: string;
  name: string;
  dailyLimit: number;
  enabled: boolean;
}

export type SmsGateCategory = 'INFORMATIONAL' | 'MARKETING';

export interface SendSmsGateMessageDto {
  userIds: string[];
  content: string;
  category: SmsGateCategory;
  deviceId?: string;
}

export interface SmsGateSendResult {
  queued: { notificationId: string; userId: string }[];
  skipped: { userId: string; reason: string }[];
}

export type SmsGateMessageStatus = 'PENDING' | 'PROCESSING' | 'SENT' | 'FAILED' | 'CANCELLED';

export interface SmsGateMessage {
  notificationId: string;
  userId: string;
  status: SmsGateMessageStatus;
  smsDeviceId: string | null;
  sentAt: string | null;
  errorDetails: { message: string } | null;
  payload: { phoneNumber?: string; username?: string } | null;
}

const BASE = `${NOTIFICATION_SERVICE_BASE_URL}/sms-gate`;

export const smsGateApi = {
  getDevices: async (): Promise<SmsDeviceListResponse> => {
    const response = await client.get<SmsDeviceListResponse>(`${BASE}/devices`);
    return response.data;
  },

  createDevice: async (values: SmsDeviceFormValues): Promise<void> => {
    await client.post(`${BASE}/devices`, values);
  },

  updateDevice: async (
    id: string,
    values: Omit<SmsDeviceFormValues, 'deviceId'>
  ): Promise<void> => {
    await client.patch(`${BASE}/devices/${id}`, values);
  },

  deleteDevice: async (id: string): Promise<void> => {
    await client.delete(`${BASE}/devices/${id}`);
  },

  send: async (dto: SendSmsGateMessageDto): Promise<SmsGateSendResult> => {
    const response = await client.post<SmsGateSendResult>(`${BASE}/messages`, dto);
    return response.data;
  },

  getMessages: async (ids: string[]): Promise<SmsGateMessage[]> => {
    const response = await client.get<SmsGateMessage[]>(`${BASE}/messages`, {
      params: { ids: ids.join(',') },
    });
    return response.data;
  },
};
