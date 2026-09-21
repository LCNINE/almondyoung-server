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
  nhnFallback?: boolean;
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
  metadata: { route?: 'nhn' } | null;
}

export interface SmsTemplateFormValues {
  name: string;
  category: SmsGateCategory;
  content: string;
}

export interface SmsTemplate extends SmsTemplateFormValues {
  id: string;
  createdBy: string;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SmsAudienceSummary {
  active: number;
  withPhone: number;
  consented: number;
}

export interface CreateSmsCampaignDto {
  name: string;
  category: SmsGateCategory;
  content: string;
  sendAt?: string;
}

export interface SmsCampaignPreview {
  audience: SmsAudienceSummary;
  recipients: number;
  excluded: number;
  ahead: number;
  window: { start: string; end: string };
  devices: { name: string; dailyLimit: number; intervalSeconds: number }[];
  estimatedStartDate: string | null;
  estimatedCompleteDate: string | null;
}

export type SmsCampaignState = 'SCHEDULED' | 'PROCESSING' | 'COMPLETED' | 'CANCELLED';

export interface SmsCampaign {
  campaignId: string;
  name: string;
  category: SmsGateCategory;
  content: string;
  sendAt: string | null;
  state: SmsCampaignState;
  createdAt: string;
  counts: { total: number; pending: number; sent: number; failed: number; cancelled: number };
  estimatedCompleteDate: string | null;
}

export type ConversationMessageState = 'pending' | 'sending' | 'sent' | 'failed' | 'cancelled';

export interface ConversationMessage {
  id: string;
  direction: 'inbound' | 'outbound';
  text: string;
  state: ConversationMessageState | null;
  deviceId: string | null;
  viaNhn: boolean;
  sentByName: string | null;
  createdAt: string;
}

export interface ConversationSummary {
  phoneNumber: string;
  userId: string | null;
  name: string | null;
  lastMessage: { text: string; receivedAt: string };
}

export interface ConversationPage {
  items: ConversationSummary[];
  total: number;
  page: number;
  limit: number;
}

export interface ConversationDetail {
  phoneNumber: string;
  userId: string | null;
  name: string | null;
  deviceId: string | null;
  messages: ConversationMessage[];
}

export interface ReplySmsConversationDto {
  phoneNumber: string;
  content: string;
  nhnFallback?: boolean;
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

  getTemplates: async (): Promise<SmsTemplate[]> => {
    const response = await client.get<SmsTemplate[]>(`${BASE}/templates`);
    return response.data;
  },

  createTemplate: async (values: SmsTemplateFormValues): Promise<void> => {
    await client.post(`${BASE}/templates`, values);
  },

  updateTemplate: async (id: string, values: SmsTemplateFormValues): Promise<void> => {
    await client.patch(`${BASE}/templates/${id}`, values);
  },

  deleteTemplate: async (id: string): Promise<void> => {
    await client.delete(`${BASE}/templates/${id}`);
  },

  getCapacity: async (deviceId?: string): Promise<{ remaining: number }> => {
    const response = await client.get<{ remaining: number }>(`${BASE}/messages/capacity`, {
      params: deviceId ? { deviceId } : undefined,
    });
    return response.data;
  },

  getAudience: async (): Promise<SmsAudienceSummary> => {
    const response = await client.get<SmsAudienceSummary>(`${BASE}/campaigns/audience`);
    return response.data;
  },

  previewCampaign: async (
    dto: Pick<CreateSmsCampaignDto, 'category' | 'sendAt'>
  ): Promise<SmsCampaignPreview> => {
    const response = await client.post<SmsCampaignPreview>(`${BASE}/campaigns/preview`, dto);
    return response.data;
  },

  getCampaigns: async (): Promise<SmsCampaign[]> => {
    const response = await client.get<SmsCampaign[]>(`${BASE}/campaigns`);
    return response.data;
  },

  createCampaign: async (dto: CreateSmsCampaignDto): Promise<{ campaignId: string; recipients: number }> => {
    const response = await client.post<{ campaignId: string; recipients: number }>(`${BASE}/campaigns`, dto);
    return response.data;
  },

  stopCampaign: async (campaignId: string): Promise<{ cancelled: number }> => {
    const response = await client.post<{ cancelled: number }>(`${BASE}/campaigns/${campaignId}/stop`);
    return response.data;
  },

  getConversations: async (params: { page: number; limit: number; q?: string }): Promise<ConversationPage> => {
    const response = await client.get<ConversationPage>(`${BASE}/conversations`, { params });
    return response.data;
  },

  getConversation: async (phoneNumber: string): Promise<ConversationDetail> => {
    const response = await client.get<ConversationDetail>(`${BASE}/conversations/messages`, {
      params: { phone: phoneNumber },
    });
    return response.data;
  },

  deleteConversation: async (phoneNumber: string): Promise<void> => {
    await client.delete(`${BASE}/conversations`, { params: { phone: phoneNumber } });
  },

  replyConversation: async (dto: ReplySmsConversationDto): Promise<SmsGateSendResult> => {
    const response = await client.post<SmsGateSendResult>(`${BASE}/conversations/reply`, dto);
    return response.data;
  },
};
