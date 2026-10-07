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

export type SmsSendRoute = 'PHONE' | 'NHN';

export const NHN_ROUTE_VALUE = 'nhn';

export interface SendSmsGateMessageDto {
  userIds: string[];
  content: string;
  category: SmsGateCategory;
  deviceId?: string;
  route?: SmsSendRoute;
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
  /** 아몬드영 회원 전체 포함 */
  includeMembers?: boolean;
  /** 수신자 그룹들. 회원·그룹 사이 겹치는 번호는 한 통만 */
  groupIds?: string[];
}

export interface SmsRecipientGroup {
  id: string;
  name: string;
  recipients: number;
  createdAt: string;
  updatedAt: string;
}

export interface SmsGroupRecipientInput {
  name?: string;
  phone: string;
}

export interface SmsGroupRecipientsResult {
  groupId: string;
  received: number;
  added: number;
  /** 휴대폰 번호가 아니거나 같은 파일 안에서 겹친 행 */
  skipped: number;
  /** 이미 그룹에 있던 번호 */
  duplicated: number;
}

export interface SmsCampaignPreview {
  recipients: number;
  excluded: number;
  duplicates: number;
  ahead: number;
  window: { start: string; end: string };
  devices: { name: string; dailyLimit: number; intervalSeconds: number }[];
  estimatedStartDate: string | null;
  estimatedCompleteDate: string | null;
  longestName: string | null;
}

export type SmsCampaignState = 'SCHEDULED' | 'PROCESSING' | 'COMPLETED' | 'CANCELLED';

export interface SmsCampaign {
  campaignId: string;
  name: string;
  category: SmsGateCategory;
  content: string;
  sendAt: string | null;
  state: SmsCampaignState;
  createdByName: string | null;
  createdAt: string;
  counts: { total: number; pending: number; sent: number; failed: number; cancelled: number };
  clicked: number;
  continuedFrom: string | null;
  continuedTo: string | null;
  estimatedCompleteDate: string | null;
}

export interface SmsCampaignClick {
  notificationId: string;
  userId: string;
  name: string | null;
  phoneNumber: string | null;
  url: string;
  clickCount: number;
  firstClickedAt: string;
  lastClickedAt: string;
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
  deviceId?: string;
  route?: SmsSendRoute;
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
    dto: Pick<CreateSmsCampaignDto, 'category' | 'sendAt' | 'includeMembers' | 'groupIds'>
  ): Promise<SmsCampaignPreview> => {
    const response = await client.post<SmsCampaignPreview>(`${BASE}/campaigns/preview`, dto);
    return response.data;
  },

  getCampaigns: async (): Promise<SmsCampaign[]> => {
    const response = await client.get<SmsCampaign[]>(`${BASE}/campaigns`);
    return response.data;
  },

  getCampaignClicks: async (campaignId: string): Promise<SmsCampaignClick[]> => {
    const response = await client.get<SmsCampaignClick[]>(`${BASE}/campaigns/${campaignId}/clicks`);
    return response.data;
  },

  createCampaign: async (dto: CreateSmsCampaignDto): Promise<{ campaignId: string; recipients: number }> => {
    const response = await client.post<{ campaignId: string; recipients: number }>(`${BASE}/campaigns`, dto);
    return response.data;
  },

  getRecipientGroups: async (): Promise<SmsRecipientGroup[]> => {
    const response = await client.get<SmsRecipientGroup[]>(`${BASE}/recipient-groups`);
    return response.data;
  },

  createRecipientGroup: async (name: string): Promise<{ id: string }> => {
    const response = await client.post<{ id: string }>(`${BASE}/recipient-groups`, { name });
    return response.data;
  },

  addGroupRecipients: async (
    groupId: string,
    recipients: SmsGroupRecipientInput[]
  ): Promise<SmsGroupRecipientsResult> => {
    const response = await client.post<SmsGroupRecipientsResult>(`${BASE}/recipient-groups/${groupId}/recipients`, {
      recipients,
    });
    return response.data;
  },

  importSupabaseGroup: async (dto: { name: string; category: string }): Promise<SmsGroupRecipientsResult> => {
    const response = await client.post<SmsGroupRecipientsResult>(`${BASE}/recipient-groups/import/supabase`, dto);
    return response.data;
  },

  deleteRecipientGroup: async (groupId: string): Promise<void> => {
    await client.delete(`${BASE}/recipient-groups/${groupId}`);
  },

  continueCampaign: async (
    campaignId: string,
    dto: { name: string; content: string; sendAt?: string }
  ): Promise<{ campaignId: string; recipients: number }> => {
    const response = await client.post<{ campaignId: string; recipients: number }>(
      `${BASE}/campaigns/${campaignId}/continue`,
      dto
    );
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
